import { describe, expect, it } from "vitest";
import { BusinessRuleError } from "../src/shared/errors.js";
import {
  assertQuarterTransition,
  localMidnight,
  localWeekStart,
  rangesOverlap,
} from "../src/configuration/domain.js";
import {
  characterCycleCreateSchema,
  ianaTimezoneSchema,
  quarterCreateSchema,
} from "../src/configuration/schemas.js";

describe("program and quarter configuration", () => {
  it("validates organization timezones as IANA zones", () => {
    expect(ianaTimezoneSchema.safeParse("America/Chicago").success).toBe(true);
    expect(ianaTimezoneSchema.safeParse("not/a-zone").success).toBe(false);
  });

  it("enforces the quarter lifecycle", () => {
    expect(() => assertQuarterTransition("draft", "scheduled")).not.toThrow();
    expect(() => assertQuarterTransition("scheduled", "open")).not.toThrow();
    expect(() => assertQuarterTransition("open", "closed")).toThrow(
      BusinessRuleError,
    );
    expect(() => assertQuarterTransition("archived", "draft")).toThrow(
      BusinessRuleError,
    );
  });

  it("treats touching inclusive quarter date ranges as overlapping", () => {
    expect(
      rangesOverlap("2026-01-01", "2026-03-31", "2026-03-31", "2026-06-01"),
    ).toBe(true);
    expect(
      rangesOverlap("2026-01-01", "2026-03-30", "2026-03-31", "2026-06-01"),
    ).toBe(false);
  });

  it("uses local calendar boundaries across DST rather than UTC Monday", () => {
    expect(localMidnight("2026-03-09", "America/Chicago").toISOString()).toBe(
      "2026-03-09T05:00:00.000Z",
    );
    expect(
      localWeekStart(new Date("2026-03-09T01:00:00Z"), "America/Chicago"),
    ).toBe("2026-03-02");
  });

  it("requires an explicit independently bounded cycle with five unique qualities", () => {
    const base = {
      organizationId: "org",
      quarterId: "quarter",
      startDate: "2026-01-01",
      endDate: "2026-02-25",
    };
    expect(
      characterCycleCreateSchema.safeParse({
        ...base,
        qualityIds: ["a", "b", "c", "d", "e"],
      }).success,
    ).toBe(true);
    expect(
      characterCycleCreateSchema.safeParse({
        ...base,
        qualityIds: ["a", "b", "c", "d", "d"],
      }).success,
    ).toBe(false);
  });

  it("requires quarter dates and a nonnegative target", () => {
    expect(
      quarterCreateSchema.safeParse({
        organizationId: "org",
        programId: "program",
        name: "Q1",
        startDate: "2026-01-01",
        endDate: "2026-03-31",
        targetPoints: 500,
      }).success,
    ).toBe(true);
  });
});
