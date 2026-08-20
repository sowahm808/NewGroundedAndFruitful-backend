import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { ConflictError } from "../shared/errors.js";
import type { AwardRequest, PointLedgerEntry } from "./domain.js";
import { localWeekStart } from "../configuration/domain.js";
import { z } from "zod";
import { pointSourceTypes } from "./domain.js";

const storedLedgerEntry = z.object({
  id: z.string().min(1), idempotencyKey: z.string().min(1),
  participantId: z.string().min(1), teamId: z.string().min(1), quarterId: z.string().min(1),
  sourceType: z.enum(pointSourceTypes), sourceId: z.string().min(1), reason: z.string(),
  awardedBy: z.string().min(1), points: z.number().int(), createdAt: z.unknown(),
  occurredAt: z.union([z.date(), z.object({ toDate: z.function().returns(z.date()) }).passthrough()])
    .transform((value) => value instanceof Date ? value : value.toDate()),
  timezone: z.string().optional(), originalEntryId: z.string().optional(),
}).passthrough();
export class PointRepository {
  constructor(private readonly db: Firestore) {}
  async award(
    input: AwardRequest,
    points: number,
  ): Promise<{ entry: PointLedgerEntry; created: boolean }> {
    const ref = this.db.doc(`pointLedger/${input.idempotencyKey}`);
    return this.db.runTransaction(async (tx) => {
      const old = await tx.get(ref);
      if (old.exists) {
        const parsed = storedLedgerEntry.parse(old.data());
        const entry: PointLedgerEntry = {
          id: parsed.id, idempotencyKey: parsed.idempotencyKey,
          participantId: parsed.participantId, teamId: parsed.teamId,
          quarterId: parsed.quarterId, sourceType: parsed.sourceType,
          sourceId: parsed.sourceId, reason: parsed.reason,
          awardedBy: parsed.awardedBy, occurredAt: parsed.occurredAt,
          points: parsed.points, createdAt: parsed.createdAt,
          ...(parsed.timezone ? { timezone: parsed.timezone } : {}),
          ...(parsed.originalEntryId ? { originalEntryId: parsed.originalEntryId } : {}),
        };
        if (!sameAward(entry, input) || entry.points !== points)
          throw new ConflictError(
            "Idempotency key was already used for another completion.",
          );
        return { entry, created: false };
      }
      const entry = {
        ...input,
        id: ref.id,
        points,
        createdAt: FieldValue.serverTimestamp(),
      };
      tx.create(ref, entry);
      this.updateAggregates(tx, input, points);
      return { entry, created: true };
    });
  }
  private updateAggregates(
    tx: Transaction,
    input: AwardRequest,
    points: number,
  ): void {
    const inc = FieldValue.increment(points);
    tx.set(
      this.db.doc(
        `participantQuarterStats/${input.quarterId}_${input.participantId}`,
      ),
      {
        participantId: input.participantId,
        quarterId: input.quarterId,
        totalPoints: inc,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      this.db.doc(`teamQuarterStats/${input.quarterId}_${input.teamId}`),
      {
        teamId: input.teamId,
        quarterId: input.quarterId,
        totalPoints: inc,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const week = localWeekStart(input.occurredAt, input.timezone ?? "UTC");
    tx.set(
      this.db.doc(`teamWeeklyStats/${input.quarterId}_${input.teamId}_${week}`),
      {
        teamId: input.teamId,
        quarterId: input.quarterId,
        week,
        totalPoints: inc,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}

function sameAward(entry: PointLedgerEntry, input: AwardRequest): boolean {
  return (
    entry.participantId === input.participantId &&
    entry.teamId === input.teamId &&
    entry.quarterId === input.quarterId &&
    entry.sourceType === input.sourceType &&
    entry.sourceId === input.sourceId &&
    entry.awardedBy === input.awardedBy &&
    entry.reason === input.reason &&
    new Date(entry.occurredAt).getTime() === input.occurredAt.getTime()
  );
}
