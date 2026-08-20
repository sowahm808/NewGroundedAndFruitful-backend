import { describe, expect, it } from "vitest";
import { parseBibleDocxPair } from "../src/bible/docx.js";

function docx(
  lines: Array<string | { text: string; underline: true }>,
): Buffer {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const xml = Buffer.from(
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines
      .map((line) => {
        const text = typeof line === "string" ? line : line.text;
        return `<w:p><w:r>${typeof line === "string" ? "" : '<w:rPr><w:u w:val="single"/></w:rPr>'}<w:t>${esc(text)}</w:t></w:r></w:p>`;
      })
      .join("")}</w:body></w:document>`,
  );
  const name = Buffer.from("word/document.xml"),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(xml.length, 18);
  local.writeUInt32LE(xml.length, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(xml.length, 20);
  central.writeUInt32LE(xml.length, 24);
  central.writeUInt16LE(name.length, 28);
  const directory = Buffer.concat([central, name]),
    eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(local.length + name.length + xml.length, 16);
  return Buffer.concat([local, name, xml, directory, eocd]);
}
const quiz = [
  "Month of July",
  "1- Ezekiel 33:7 “Watchman”",
  "Question one?",
  "a.First",
  "b.Second",
  "Question two?",
  "a.Yes",
  "b.No",
  "c.Maybe",
  "d.Always",
  "e.Never",
];
describe("Bible DOCX importer", () => {
  it("extracts ordered activities, variable question counts, and five choices with an underlined answer", () => {
    const key = quiz.map((x) =>
      x === "b.Second"
        ? { text: x, underline: true as const }
        : x === "e.Never"
          ? { text: x, underline: true as const }
          : x,
    );
    const parsed = parseBibleDocxPair(docx(quiz), docx(key), {
      startDate: "2026-07-01",
      endDate: "2026-09-30",
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.items[0]).toMatchObject({
      localDate: "2026-07-01",
      month: 7,
      dayOfMonth: 1,
      scriptureReference: "Ezekiel 33:7",
      title: "Watchman",
    });
    expect(parsed.items[0]?.questions).toHaveLength(2);
    expect(parsed.items[0]?.questions[1]?.choices).toHaveLength(5);
    expect(parsed.items[0]?.questions.map((q) => q.correctChoiceId)).toEqual([
      "b",
      "e",
    ]);
    expect(parsed.checksums.quiz).toMatch(/^[a-f0-9]{64}$/);
  });
  it("blocks missing, multiple, mismatched and out-of-quarter answers", () => {
    const key = quiz.map((x) =>
      x === "a.First" || x === "b.Second"
        ? { text: x, underline: true as const }
        : x,
    );
    const parsed = parseBibleDocxPair(docx(quiz), docx(key), {
      startDate: "2026-08-01",
      endDate: "2026-09-30",
    });
    expect(parsed.errors.join(" ")).toContain("outside the selected quarter");
    expect(parsed.errors.join(" ")).toContain("Multiple underlined");
    expect(parsed.errors.join(" ")).toContain("No underlined");
  });
  it("rejects malformed and non-DOCX input", () => {
    expect(() =>
      parseBibleDocxPair(Buffer.from("no"), docx(quiz), {
        startDate: "2026-07-01",
        endDate: "2026-09-30",
      }),
    ).toThrowError(/not a DOCX/);
  });
});
