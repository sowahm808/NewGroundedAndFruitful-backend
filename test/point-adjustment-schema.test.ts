import { describe, expect, it } from "vitest";
import { pointAdjustmentSchema } from "../src/points/schemas.js";

describe("administrator point adjustment input", () => {
  it("accepts a signed, non-zero manual adjustment with a reason", () => {
    const result = pointAdjustmentSchema.safeParse({
      type: "adjustment",
      participantId: "participant-1",
      teamId: "team-1",
      quarterId: "quarter-1",
      points: -5,
      reason: "Correct duplicate attendance award",
      occurredAt: "2026-08-19T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("requires reversal requests to link to an original entry", () => {
    expect(
      pointAdjustmentSchema.safeParse({
        type: "reversal",
        reason: "Completion was entered in error",
      }).success,
    ).toBe(false);
  });

  it("rejects zero-value adjustments and client-supplied audit fields", () => {
    expect(
      pointAdjustmentSchema.safeParse({
        type: "adjustment",
        participantId: "participant-1",
        teamId: "team-1",
        quarterId: "quarter-1",
        points: 0,
        reason: "No change",
        occurredAt: "2026-08-19T12:00:00.000Z",
        actorId: "spoofed-admin",
      }).success,
    ).toBe(false);
  });
});
