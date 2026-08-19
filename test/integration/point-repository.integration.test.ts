import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PointRepository } from "../../src/points/repository.js";
import type { AwardRequest } from "../../src/points/domain.js";
import "../../src/config/firebase.js";

const db = getFirestore();
const repository = new PointRepository(db);
const input: AwardRequest = {
  participantId: "participant-integration",
  teamId: "team-integration",
  quarterId: "quarter-integration",
  sourceType: "reading",
  sourceId: "reading-integration",
  reason: "Verified participation",
  awardedBy: "actor-integration",
  idempotencyKey: "integration-point-award-0001",
  occurredAt: new Date("2026-08-19T12:00:00.000Z"),
};

beforeEach(async () => {
  await Promise.all(
    [
      `pointLedger/${input.idempotencyKey}`,
      `participantQuarterStats/${input.quarterId}_${input.participantId}`,
      `teamQuarterStats/${input.quarterId}_${input.teamId}`,
      `teamWeeklyStats/${input.quarterId}_${input.teamId}_2026-08-17`,
    ].map((path) => db.doc(path).delete()),
  );
});

afterAll(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("PointRepository against the Firestore emulator", () => {
  it("commits one ledger entry and all aggregates atomically", async () => {
    const result = await repository.award(input, 7);

    expect(result.created).toBe(true);
    const [ledger, participant, team, week] = await Promise.all([
      db.doc(`pointLedger/${input.idempotencyKey}`).get(),
      db
        .doc(
          `participantQuarterStats/${input.quarterId}_${input.participantId}`,
        )
        .get(),
      db.doc(`teamQuarterStats/${input.quarterId}_${input.teamId}`).get(),
      db
        .doc(`teamWeeklyStats/${input.quarterId}_${input.teamId}_2026-08-17`)
        .get(),
    ]);
    expect(ledger.get("points")).toBe(7);
    expect(participant.get("totalPoints")).toBe(7);
    expect(team.get("totalPoints")).toBe(7);
    expect(week.get("totalPoints")).toBe(7);
  });

  it("makes concurrent retries idempotent", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => repository.award(input, 7)),
    );

    expect(results.filter(({ created }) => created)).toHaveLength(1);
    expect(
      (
        await db
          .doc(
            `participantQuarterStats/${input.quarterId}_${input.participantId}`,
          )
          .get()
      ).get("totalPoints"),
    ).toBe(7);
  });
});
