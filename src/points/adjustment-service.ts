import type {
  Firestore,
  Timestamp,
  Transaction,
} from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin, type Principal } from "../auth/authorization.js";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "../shared/errors.js";
import type { PointLedgerEntry } from "./domain.js";
import type { PointAdjustmentInput } from "./schemas.js";

type StoredEntry = Omit<PointLedgerEntry, "occurredAt"> & {
  occurredAt: Date | Timestamp;
  organizationId?: string;
};

export class PointAdjustmentService {
  constructor(private readonly db: Firestore) {}

  async record(
    principal: Principal | undefined,
    input: PointAdjustmentInput,
    idempotencyKey: string,
  ) {
    const actor = requireAdmin(principal);
    const entryRef = this.db.doc(`pointLedger/${idempotencyKey}`);

    return this.db.runTransaction(async (tx) => {
      const existing = await tx.get(entryRef);
      if (existing.exists) {
        const entry = existing.data() as StoredEntry;
        if (
          entry.awardedBy !== actor.uid ||
          entry.sourceType !== "adjustment" ||
          !entry.organizationId ||
          !actor.organizationIds.includes(entry.organizationId) ||
          !sameAdjustment(entry, input)
        )
          throw new ConflictError(
            "Idempotency key was already used for another operation.",
          );
        return { entry, created: false };
      }

      let original: StoredEntry | undefined;
      let organizationId: string;
      let participantId: string;
      let teamId: string;
      let quarterId: string;
      let points: number;
      let occurredAt: Date | Timestamp;
      if (input.type === "reversal") {
        const originalRef = this.db.doc(`pointLedger/${input.originalEntryId}`);
        const reversalRef = this.db.doc(
          `pointReversals/${input.originalEntryId}`,
        );
        const [originalSnapshot, reversal] = await Promise.all([
          tx.get(originalRef),
          tx.get(reversalRef),
        ]);
        if (!originalSnapshot.exists) throw new NotFoundError();
        if (reversal.exists)
          throw new ConflictError("The point entry has already been reversed.");
        original = originalSnapshot.data() as StoredEntry;
        if (original.sourceType === "adjustment" || original.points <= 0)
          throw new ConflictError("This point entry cannot be reversed.");
        organizationId = await this.authorizeParticipant(
          tx,
          actor.organizationIds,
          original.participantId,
          original.teamId,
          original.quarterId,
          original.organizationId,
        );
        participantId = original.participantId;
        teamId = original.teamId;
        quarterId = original.quarterId;
        points = -original.points;
        occurredAt = original.occurredAt;
        tx.create(reversalRef, {
          originalEntryId: input.originalEntryId,
          reversalEntryId: entryRef.id,
          organizationId,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        organizationId = await this.authorizeParticipant(
          tx,
          actor.organizationIds,
          input.participantId,
          input.teamId,
          input.quarterId,
        );
        participantId = input.participantId;
        teamId = input.teamId;
        quarterId = input.quarterId;
        points = input.points;
        occurredAt = input.occurredAt;
      }
      const entry: StoredEntry = {
        id: entryRef.id,
        idempotencyKey,
        participantId,
        teamId,
        quarterId,
        organizationId,
        sourceType: "adjustment",
        sourceId: original
          ? `reversal:${original.id}`
          : `adjustment:${entryRef.id}`,
        reason: input.reason,
        awardedBy: actor.uid,
        occurredAt,
        points,
        ...(original ? { originalEntryId: original.id } : {}),
        createdAt: FieldValue.serverTimestamp(),
      };
      tx.create(entryRef, entry);
      this.updateAggregates(tx, entry, points);
      tx.create(this.db.collection("auditLogs").doc(), {
        event: original ? "POINT_ENTRY_REVERSED" : "POINTS_ADJUSTED",
        actorId: actor.uid,
        organizationId,
        participantId,
        teamId,
        quarterId,
        adjustmentEntryId: entryRef.id,
        ...(original ? { originalEntryId: original.id } : {}),
        reason: input.reason,
        points,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { entry, created: true };
    });
  }

  private async authorizeParticipant(
    tx: Transaction,
    organizationIds: readonly string[],
    participantId: string,
    teamId: string,
    quarterId: string,
    expectedOrganizationId?: string,
  ) {
    const [participant, team, quarter] = await Promise.all([
      tx.get(this.db.doc(`participants/${participantId}`)),
      tx.get(this.db.doc(`teams/${teamId}`)),
      tx.get(this.db.doc(`quarters/${quarterId}`)),
    ]);
    if (!participant.exists || !team.exists || !quarter.exists)
      throw new NotFoundError();
    const organizationId = participant.get("organizationId") as unknown;
    if (
      typeof organizationId !== "string" ||
      !organizationIds.includes(organizationId) ||
      (expectedOrganizationId && expectedOrganizationId !== organizationId) ||
      team.get("organizationId") !== organizationId ||
      quarter.get("organizationId") !== organizationId ||
      (participant.get("activeTeamId") ?? participant.get("teamId")) !== teamId
    )
      throw new AuthorizationError();
    return organizationId;
  }

  private updateAggregates(
    tx: Transaction,
    entry: StoredEntry,
    points: number,
  ) {
    const increment = FieldValue.increment(points);
    tx.set(
      this.db.doc(
        `participantQuarterStats/${entry.quarterId}_${entry.participantId}`,
      ),
      { totalPoints: increment, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(
      this.db.doc(`teamQuarterStats/${entry.quarterId}_${entry.teamId}`),
      { totalPoints: increment, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    const occurredAt = entry.occurredAt;
    const weekDate = new Date(
      occurredAt instanceof Date ? occurredAt : occurredAt.toDate(),
    );
    weekDate.setUTCHours(0, 0, 0, 0);
    weekDate.setUTCDate(
      weekDate.getUTCDate() - (weekDate.getUTCDay() || 7) + 1,
    );
    const week = weekDate.toISOString().slice(0, 10);
    tx.set(
      this.db.doc(`teamWeeklyStats/${entry.quarterId}_${entry.teamId}_${week}`),
      { totalPoints: increment, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
}

function sameAdjustment(entry: StoredEntry, input: PointAdjustmentInput) {
  if (entry.reason !== input.reason) return false;
  if (input.type === "reversal")
    return entry.originalEntryId === input.originalEntryId;
  const storedDate = entry.occurredAt;
  const storedMillis =
    storedDate instanceof Date
      ? storedDate.getTime()
      : storedDate.toDate().getTime();
  return (
    !entry.originalEntryId &&
    entry.participantId === input.participantId &&
    entry.teamId === input.teamId &&
    entry.quarterId === input.quarterId &&
    entry.points === input.points &&
    storedMillis === input.occurredAt.getTime()
  );
}
