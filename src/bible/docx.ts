/* eslint-disable @typescript-eslint/restrict-template-expressions, no-useless-escape */
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { AppError } from "../shared/errors.js";
import {
  PARSER_VERSION,
  previewItemSchema,
  type BiblePreviewItem,
} from "./domain.js";

const LIMITS = {
  file: 5 * 1024 * 1024,
  unpacked: 20 * 1024 * 1024,
  entries: 2000,
  paragraphs: 5000,
};
const fail = (code: string, message: string) =>
  new AppError(422, code, message);
const entities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
export interface Paragraph {
  text: string;
  underlined: boolean;
  sourceNumber?: string;
}

export function extractDocx(buffer: Buffer): Paragraph[] {
  if (buffer.length > LIMITS.file)
    throw new AppError(
      413,
      "BIBLE_IMPORT_FILE_INVALID",
      "DOCX exceeds the 5 MiB per-file limit.",
    );
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b)
    throw new AppError(
      415,
      "BIBLE_IMPORT_FILE_INVALID",
      "File is not a DOCX ZIP package.",
    );
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0)
    throw fail("BIBLE_IMPORT_FILE_INVALID", "Malformed DOCX package.");
  const count = buffer.readUInt16LE(eocd + 10),
    offset = buffer.readUInt32LE(eocd + 16);
  if (count > LIMITS.entries)
    throw fail(
      "BIBLE_IMPORT_FILE_INVALID",
      "DOCX contains too many archive entries.",
    );
  let cursor = offset,
    total = 0;
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50)
      throw fail("BIBLE_IMPORT_FILE_INVALID", "Malformed DOCX directory.");
    const method = buffer.readUInt16LE(cursor + 10),
      compressed = buffer.readUInt32LE(cursor + 20),
      size = buffer.readUInt32LE(cursor + 24),
      nameLen = buffer.readUInt16LE(cursor + 28),
      extra = buffer.readUInt16LE(cursor + 30),
      comment = buffer.readUInt16LE(cursor + 32),
      local = buffer.readUInt32LE(cursor + 42),
      name = buffer
        .subarray(cursor + 46, cursor + 46 + nameLen)
        .toString("utf8");
    total += size;
    if (
      total > LIMITS.unpacked ||
      size > Math.max(compressed * 100, 1024 * 1024)
    )
      throw fail(
        "BIBLE_IMPORT_FILE_INVALID",
        "Unsafe DOCX compression ratio or expanded size.",
      );
    if (name === "word/vbaProject.bin" || name.endsWith(".bin"))
      throw fail(
        "BIBLE_IMPORT_FILE_INVALID",
        "Macro-enabled DOCX content is prohibited.",
      );
    if (
      ["word/document.xml", "word/styles.xml", "word/numbering.xml"].includes(
        name,
      )
    ) {
      const ln = buffer.readUInt16LE(local + 26),
        le = buffer.readUInt16LE(local + 28),
        data = buffer.subarray(
          local + 30 + ln + le,
          local + 30 + ln + le + compressed,
        );
      const contents =
        method === 0 ? data : method === 8 ? inflateRawSync(data) : undefined;
      if (contents) files.set(name, contents);
    }
    cursor += 46 + nameLen + extra + comment;
  }
  const xml = files.get("word/document.xml");
  if (!xml)
    throw fail(
      "BIBLE_IMPORT_FILE_INVALID",
      "DOCX is missing word/document.xml.",
    );
  const source = xml.toString("utf8");
  if (!source.includes("word/document.xml") && !source.includes("<w:document"))
    throw fail(
      "BIBLE_IMPORT_FILE_INVALID",
      "Invalid WordprocessingML document.",
    );
  const styles = files.get("word/styles.xml")?.toString("utf8") ?? "";
  const underlinedStyles = new Map<string, boolean>();
  for (const match of styles.matchAll(
    /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g,
  )) {
    const id = /w:styleId="([^"]+)"/.exec(match[1]!)?.[1];
    if (!id) continue;
    const value = /<w:u(?:\s[^>]*)?\/?\s*>/.exec(match[2]!)?.[0];
    if (value) underlinedStyles.set(id, !/w:val="(?:none|0)"/.test(value));
  }
  // Resolve the simple decimal-list form used by the supported template. The
  // source number is metadata: it is not folded into content fingerprints.
  const counters = new Map<string, number>();
  const paragraphs = [...source.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)]
    .map((m) => {
      let underlined = false;
      let text = "";
      const numId = /<w:numId[^>]*w:val="(\d+)"/.exec(m[1]!)?.[1];
      const level = /<w:ilvl[^>]*w:val="(\d+)"/.exec(m[1]!)?.[1] ?? "0";
      let sourceNumber: string | undefined;
      if (numId) {
        const key = `${numId}:${level}`;
        const number = (counters.get(key) ?? 0) + 1;
        counters.set(key, number);
        sourceNumber = String(number);
      }
      for (const run of m[1]!.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
        const body = run[1]!;
        const direct = /<w:u(?:\s[^>]*)?\/?\s*>/.exec(body)?.[0];
        const styleId = /<w:rStyle[^>]*w:val="([^"]+)"/.exec(body)?.[1];
        const u = direct
          ? !/w:val="(?:none|0)"/.test(direct)
          : (styleId ? underlinedStyles.get(styleId) : false) === true;
        for (const t of body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
          text += entities(t[1]!);
          if (u && t[1]!.trim()) underlined = true;
        }
        if (/<w:tab\s*\/>/.test(body)) text += "\t";
        if (/<w:(?:br|cr)\b[^>]*\/>/.test(body)) text += "\n";
      }
      return {
        text: text.replace(/[\u00a0\s]+/g, " ").trim(),
        underlined,
        ...(sourceNumber ? { sourceNumber } : {}),
      };
    })
    .filter((p) => p.text);
  if (paragraphs.length > LIMITS.paragraphs)
    throw fail(
      "BIBLE_IMPORT_FILE_INVALID",
      "DOCX contains too many paragraphs.",
    );
  return paragraphs;
}
const months: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};
const norm = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
// Product policy treats terminal punctuation as presentation-only on choices,
// but never on prompts (where it can change meaning).
const normChoice = (s: string) => norm(s).replace(/[.!?]+$/u, "");
const fingerprint = (s: string, choiceText = false) =>
  createHash("sha256")
    .update(choiceText ? normChoice(s) : norm(s))
    .digest("hex");
const choice = /^([a-e])[.\)\-]\s*(.+)$/i,
  heading = /^(\d{1,2})\s*-\s*(.+)$/;
interface ParsedQuestion {
  ordinal: number;
  sourceNumber?: string;
  prompt: string;
  choices: Array<{
    id: string;
    label: string;
    text: string;
    underlined: boolean;
  }>;
  originalText: string;
}
interface RawItem {
  month: number;
  day: number;
  heading: string;
  questions: ParsedQuestion[];
  originalText: string;
}
function parse(paragraphs: Paragraph[]): RawItem[] {
  let month: number | undefined,
    current: RawItem | undefined,
    q: ParsedQuestion | undefined;
  const items: RawItem[] = [];
  for (const p of paragraphs) {
    const mh = /^Month of ([A-Za-z]+)$/i.exec(p.text);
    if (mh) {
      month = months[mh[1]!.toLowerCase()];
      if (!month)
        throw fail("BIBLE_IMPORT_PARSE_FAILED", `Unrecognized month: ${mh[1]}`);
      continue;
    }
    const ah = heading.exec(p.text);
    if (ah) {
      if (!month)
        throw fail(
          "BIBLE_IMPORT_PARSE_FAILED",
          "Activity heading appears before a month heading.",
        );
      current = {
        month,
        day: Number(ah[1]),
        heading: ah[2]!.trim(),
        questions: [],
        originalText: p.text,
      };
      items.push(current);
      q = undefined;
      continue;
    }
    if (!current)
      throw fail(
        "BIBLE_IMPORT_PARSE_FAILED",
        "Content appears before an activity heading.",
      );
    let cm = choice.exec(p.text);
    // Real Word documents occasionally omit the separator after the final
    // choice ("eNone" / "ea & b"). Only accept that spelling when it is the
    // next sequential choice, otherwise ordinary questions beginning with a-e
    // would be misclassified.
    if (!cm && q) {
      const expected = String.fromCharCode(97 + q.choices.length);
      const loose = /^([a-e])\s*(.+)$/i.exec(p.text);
      if (loose?.[1]?.toLowerCase() === expected) cm = loose;
    }
    if (cm) {
      if (!q)
        throw fail(
          "BIBLE_IMPORT_PARSE_FAILED",
          "Choice appears before a question.",
        );
      q.choices.push({
        id: cm[1]!.toLowerCase(),
        label: cm[1]!.toLowerCase(),
        text: cm[2]!.trim(),
        underlined: p.underlined,
      });
      q.originalText += `\n${p.text}`;
    } else {
      const literal = /^(\d{1,3})[.)-]\s+(.+)$/.exec(p.text);
      const prompt = literal?.[2] ?? p.text;
      q = {
        ordinal: current.questions.length + 1,
        ...(literal?.[1] || p.sourceNumber
          ? { sourceNumber: literal?.[1] ?? p.sourceNumber! }
          : {}),
        prompt,
        choices: [],
        originalText: p.text,
      };
      current.questions.push(q);
      current.originalText += `\n${p.text}`;
    }
  }
  if (!items.length)
    throw fail("BIBLE_IMPORT_PARSE_FAILED", "No activities were found.");
  return items;
}
function splitHeading(value: string) {
  const quoted = /^(.+?)\s+[“"](.+)[”"]$/.exec(value);
  if (quoted) return { scripture: quoted[1]!.trim(), title: quoted[2]!.trim() };
  const parts = value.split(/\s+(?=[A-Z][a-z])/);
  return { scripture: parts.shift() ?? value, title: parts.join(" ") || value };
}
export function parseBibleDocxPair(
  quiz: Buffer,
  key: Buffer,
  quarter: { startDate: string; endDate: string },
) {
  const qr = parse(extractDocx(quiz)),
    kr = parse(extractDocx(key));
  const errors: string[] = [],
    warnings: string[] = [],
    year = Number(quarter.startDate.slice(0, 4));
  const items: BiblePreviewItem[] = [];
  for (const [i, a] of qr.entries()) {
    const match = kr.find(
      (k) =>
        k.month === a.month &&
        k.day === a.day &&
        norm(k.heading) === norm(a.heading),
    );
    if (!match) {
      errors.push(`Answer-key mismatch for month ${a.month}, day ${a.day}.`);
      continue;
    }
    const localDate = `${year}-${String(a.month).padStart(2, "0")}-${String(a.day).padStart(2, "0")}`;
    if (localDate < quarter.startDate || localDate > quarter.endDate)
      errors.push(`Date ${localDate} is outside the selected quarter.`);
    const questions = [];
    const questionNumbers = a.questions
      .map((q) => q.sourceNumber)
      .filter(Boolean);
    if (new Set(questionNumbers).size !== questionNumbers.length)
      errors.push(
        `QUESTION_NUMBER_DUPLICATE: Question number is duplicated on ${localDate}.`,
      );
    for (const [j, q] of a.questions.entries()) {
      // Ordinal is authoritative when question numbers are absent. This avoids
      // selecting the first of two intentionally repeated prompts.
      const kq = q.sourceNumber
        ? match.questions.find((x) => x.sourceNumber === q.sourceNumber)
        : match.questions[j];
      const displayNumber = q.sourceNumber ?? String(q.ordinal);
      if (!kq || fingerprint(kq.prompt) !== fingerprint(q.prompt)) {
        errors.push(
          `QUESTION_NOT_MATCHED: Question ${displayNumber} does not match the question document (${localDate}).`,
        );
        continue;
      }
      if (q.choices.length < 2)
        errors.push(`Question has fewer than two choices on ${localDate}.`);
      const ids = q.choices.map((c) => c.id);
      if (new Set(ids).size !== ids.length)
        errors.push(`Duplicate choice IDs on ${localDate}.`);
      if (q.choices.length !== kq.choices.length)
        errors.push(
          `CHOICE_COUNT_MISMATCH: Question ${displayNumber} has a different choice count (${localDate}).`,
        );
      const choicesMatch = q.choices.every((c) => {
        const answerChoice = kq.choices.find(
          (candidate) => candidate.label === c.label,
        );
        return (
          answerChoice &&
          fingerprint(answerChoice.text, true) === fingerprint(c.text, true)
        );
      });
      if (!choicesMatch)
        errors.push(
          `CHOICE_NOT_MATCHED: Question ${displayNumber} has a choice that does not match (${localDate}).`,
        );
      const marked = kq.choices.filter((c) => c.underlined);
      if (marked.length !== 1)
        errors.push(
          `${marked.length ? "CORRECT_ANSWER_AMBIGUOUS" : "CORRECT_ANSWER_MISSING"}: Question ${displayNumber} ${marked.length ? "has multiple underlined correct answers" : "has no underlined correct answer"} (${localDate}).`,
        );
      const correct = marked[0]?.id ?? "a";
      if (
        marked.length === 1 &&
        !q.choices.some(
          (c) =>
            c.id === correct &&
            normChoice(c.text) === normChoice(marked[0]?.text ?? ""),
        )
      )
        errors.push(
          `CHOICE_NOT_MATCHED: Question ${displayNumber}'s marked answer does not match (${localDate}).`,
        );
      if (q.choices.length >= 5)
        warnings.push(
          `Five choices require review on ${localDate}: ${q.prompt}`,
        );
      if (q.prompt.length > 500 || q.choices.some((c) => c.text.length > 300))
        warnings.push(`Long editorial text requires review on ${localDate}.`);
      questions.push({
        id: `q${j + 1}`,
        position: j + 1,
        prompt: q.prompt,
        choices: q.choices.map(({ id, label, text }) => ({ id, label, text })),
        correctChoiceId: correct,
        originalText: q.originalText,
        version: 1,
      });
    }
    if (a.questions.length !== 3)
      warnings.push(
        `Unexpected question count (${a.questions.length}) on ${localDate}.`,
      );
    const h = splitHeading(a.heading);
    const candidate = {
      id: `item-${i + 1}`,
      month: a.month,
      dayOfMonth: a.day,
      localDate,
      scriptureReference: h.scripture,
      title: h.title,
      position: i + 1,
      questions,
      originalText: a.originalText,
      version: 1,
    };
    const checked = previewItemSchema.safeParse(candidate);
    if (checked.success) items.push(checked.data);
    else
      errors.push(
        `Invalid activity ${localDate}: ${checked.error.issues.map((x) => x.message).join(", ")}`,
      );
  }
  const dates = items.map((x) => x.localDate);
  for (const d of new Set(dates))
    if (dates.filter((x) => x === d).length > 1)
      errors.push(`Duplicate activity date ${d}.`);
  return {
    parserVersion: PARSER_VERSION,
    checksums: {
      quiz: createHash("sha256").update(quiz).digest("hex"),
      answerKey: createHash("sha256").update(key).digest("hex"),
    },
    items,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    diagnostics: {
      questionDocumentCount: qr.reduce(
        (sum, item) => sum + item.questions.length,
        0,
      ),
      answerKeyDocumentCount: kr.reduce(
        (sum, item) => sum + item.questions.length,
        0,
      ),
      unmatchedQuestionNumbers: errors
        .filter((value) => value.startsWith("QUESTION_NOT_MATCHED"))
        .map((value) => /Question (\d+)/.exec(value)?.[1])
        .filter((value): value is string => Boolean(value))
        .slice(0, 50),
      missingCorrectAnswerNumbers: errors
        .filter((value) => value.startsWith("CORRECT_ANSWER_MISSING"))
        .map((value) => /Question (\d+)/.exec(value)?.[1])
        .filter((value): value is string => Boolean(value))
        .slice(0, 50),
      duplicateQuestionNumbers: errors
        .filter((value) => value.startsWith("QUESTION_NUMBER_DUPLICATE"))
        .slice(0, 50)
        .map(() => "duplicate"),
      truncated: errors.length > 50,
    },
  };
}
