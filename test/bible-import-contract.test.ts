import { describe, expect, it } from "vitest";
import { serializeImportPreviewActivity } from "../src/bible/service.js";

describe("Bible import review contract", () => {
  it("exposes the persisted local date as the required review date", () => {
    const activity = serializeImportPreviewActivity({
      id: "item-1",
      localDate: "2026-07-01",
      title: "Watchman",
    });

    expect(activity).toMatchObject({
      id: "item-1",
      date: "2026-07-01",
      localDate: "2026-07-01",
      title: "Watchman",
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
