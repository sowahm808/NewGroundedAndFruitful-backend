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
    total = 0,
    xml: Buffer | undefined;
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
    if (name === "word/document.xml") {
      const ln = buffer.readUInt16LE(local + 26),
        le = buffer.readUInt16LE(local + 28),
        data = buffer.subarray(
          local + 30 + ln + le,
          local + 30 + ln + le + compressed,
        );
      xml =
        method === 0 ? data : method === 8 ? inflateRawSync(data) : undefined;
    }
    cursor += 46 + nameLen + extra + comment;
  }
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
  const paragraphs = [...source.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)]
    .map((m) => {
      let underlined = false;
      let text = "";
      for (const run of m[1]!.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
        const body = run[1]!;
        const u =
          /<w:u(?:\s[^>]*)?\/?>(?![\s\S]*w:val="none")/.test(body) &&
          !/<w:u[^>]*w:val="(?:none|0)"/.test(body);
        for (const t of body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
          text += entities(t[1]!);
          if (u && t[1]!.trim()) underlined = true;
        }
        if (/<w:tab\s*\/>/.test(body)) text += "\t";
      }
      return { text: text.replace(/\s+/g, " ").trim(), underlined };
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
const choice = /^([a-e])[.\)\-]\s*(.+)$/i,
  heading = /^(\d{1,2})\s*-\s*(.+)$/;
interface ParsedQuestion {
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
      q = { prompt: p.text, choices: [], originalText: p.text };
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
    const seen = new Set<string>();
    for (const [j, q] of a.questions.entries()) {
      const kq = match.questions.find((x) => norm(x.prompt) === norm(q.prompt));
      if (!kq) {
        errors.push(`Question mismatch on ${localDate}: ${q.prompt}`);
        continue;
      }
      if (seen.has(norm(q.prompt)))
        errors.push(`Duplicate question on ${localDate}: ${q.prompt}`);
      seen.add(norm(q.prompt));
      if (q.choices.length < 2)
        errors.push(`Question has fewer than two choices on ${localDate}.`);
      const ids = q.choices.map((c) => c.id);
      if (new Set(ids).size !== ids.length)
        errors.push(`Duplicate choice IDs on ${localDate}.`);
      const marked = kq.choices.filter((c) => c.underlined);
      if (marked.length !== 1)
        errors.push(
          `${marked.length ? "Multiple" : "No"} underlined correct answers on ${localDate}: ${q.prompt}`,
        );
      const correct = marked[0]?.id ?? "a";
      if (
        !q.choices.some(
          (c) =>
            c.id === correct && norm(c.text) === norm(marked[0]?.text ?? ""),
        )
      )
        errors.push(
          `Correct answer not found in child choices on ${localDate}.`,
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
  };
}
