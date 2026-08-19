import { describe, expect, it } from "vitest";
import {
  completionAward,
  type AwardRequest,
  type PointRule,
} from "../src/points/domain.js";
import { validateFinalAssessment } from "../src/character/domain.js";
import { assertProjectTransition } from "../src/projects/domain.js";
const input = (sourceType: AwardRequest["sourceType"]): AwardRequest => ({
  participantId: "child",
  teamId: "team",
  quarterId: "q",
  sourceType,
  sourceId: "source",
  reason: "completion",
  awardedBy: "system",
  idempotencyKey: `${sourceType}:child:source`,
  occurredAt: new Date("2026-01-02"),
});
const rule = (activityType: PointRule["activityType"]): PointRule => ({
  activityType,
  points: 10,
  enabled: true,
  effectiveFrom: new Date("2026-01-01"),
});
describe("participation-only point invariant", () => {
  it("character ratings cannot alter points", () => {
    validateFinalAssessment([0, 0, 0, 0, 0]);
    validateFinalAssessment([10, 10, 10, 10, 10]);
    expect(
      completionAward(
        rule("character_assessment"),
        input("character_assessment"),
      ),
    ).toBe(10);
  });
  it("Bible correctness cannot alter the point input", () =>
    expect(
      completionAward(rule("bible_activity"), input("bible_activity")),
    ).toBe(10));
  it("academic grades cannot alter the point input", () =>
    expect(
      completionAward(rule("academic_session"), input("academic_session")),
    ).toBe(10));
  it("rejects incomplete assessments", () =>
    expect(() => validateFinalAssessment([1, 2])).toThrow(/Complete all five/));
});
describe("point rule safety", () => {
  it("rejects negative and fractional point rules", () => {
    expect(
      completionAward({ ...rule("reading"), points: -1 }, input("reading")),
    ).toBe(0);
    expect(
      completionAward({ ...rule("reading"), points: 1.5 }, input("reading")),
    ).toBe(0);
  });
});
describe("project transitions", () => {
  it("allows the configured workflow", () =>
    expect(() => assertProjectTransition("idea", "goal")).not.toThrow());
  it("rejects arbitrary jumps", () =>
    expect(() => assertProjectTransition("idea", "completed")).toThrow(
      /Cannot transition/,
    ));
});
