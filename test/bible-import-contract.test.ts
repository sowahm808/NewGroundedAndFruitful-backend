import { describe, expect, it } from "vitest";
import {
  quarterAllowsBibleImports,
  serializeImportPreviewActivity,
} from "../src/bible/service.js";

describe("Bible import review contract", () => {
  it("allows imports for canonical open quarters and legacy active quarters", () => {
    expect(quarterAllowsBibleImports("draft")).toBe(true);
    expect(quarterAllowsBibleImports("open")).toBe(true);
    expect(quarterAllowsBibleImports("active")).toBe(true);
    expect(quarterAllowsBibleImports(undefined)).toBe(true);
    expect(quarterAllowsBibleImports("closed")).toBe(false);
    expect(quarterAllowsBibleImports("archived")).toBe(false);
  });

  it("exposes the persisted local date as the required review date", () => {
    const activity = serializeImportPreviewActivity({
      id: "item-1",
      localDate: "2026-07-01",
      title: "Watchman",
      questions: [
        {
          id: "q1",
          position: 1,
          prompt: "First question?",
          correctChoiceId: "b",
          choices: [
            { id: "a", label: "a", text: "First" },
            { id: "b", label: "b", text: "Second" },
          ],
        },
        { id: "q2", number: 7, position: 2, prompt: "Second question?" },
      ],
    });

    expect(activity).toMatchObject({
      id: "item-1",
      date: "2026-07-01",
      localDate: "2026-07-01",
      title: "Watchman",
      questions: [
        expect.objectContaining({
          id: "q1",
          number: 1,
          choices: [
            expect.objectContaining({ id: "a", isCorrect: false }),
            expect.objectContaining({ id: "b", isCorrect: true }),
          ],
        }),
        expect.objectContaining({ id: "q2", number: 7 }),
      ],
    });
  });

  it("does not overwrite an explicitly serialized review date", () => {
    expect(
      serializeImportPreviewActivity({
        date: "2026-07-02",
        localDate: "2026-07-01",
      }).date,
    ).toBe("2026-07-02");
  });
});
