import { describe, expect, it } from "vitest";
import { serializeImportPreviewActivity } from "../src/bible/service.js";

describe("Bible import review contract", () => {
  it("exposes the persisted local date as the required review date", () => {
    const activity = serializeImportPreviewActivity({
      id: "item-1",
      localDate: "2026-07-01",
      title: "Watchman",
      questions: [
        { id: "q1", position: 1, prompt: "First question?" },
        { id: "q2", number: 7, position: 2, prompt: "Second question?" },
      ],
    });

    expect(activity).toMatchObject({
      id: "item-1",
      date: "2026-07-01",
      localDate: "2026-07-01",
      title: "Watchman",
      questions: [
        expect.objectContaining({ id: "q1", number: 1 }),
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
