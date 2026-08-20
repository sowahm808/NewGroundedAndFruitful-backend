import type { Firestore, Query } from "firebase-admin/firestore";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { requireAdmin, type Principal } from "../auth/authorization.js";
import { AuthorizationError, ConflictError, NotFoundError } from "../shared/errors.js";
import type { z } from "zod";
import type { reconciliationRollbackSchema, reconciliationSchema } from "./schemas.js";

type RunInput = z.infer<typeof reconciliationSchema>;
type RollbackInput = z.infer<typeof reconciliationRollbackSchema>;
type Totals = { participants: Map<string, number>; teams: Map<string, number> };

/** Resumable ledger rebuild. Generations are immutable after activation; only a pointer is switched. */
export class ReconciliationService {
  constructor(private readonly db: Firestore) {}
  async run(principal: Principal | undefined, input: RunInput) {
    const actor = requireAdmin(principal); this.organization(actor.organizationIds, input.organizationId);
    const generationRef = this.db.doc(`aggregateGenerations/${input.generationId}`), existing = await generationRef.get();
    if (existing.exists && (existing.get("organizationId") !== input.organizationId || existing.get("status") === "active")) throw new ConflictError("The aggregate generation cannot be changed.");
    let query: Query = this.db.collection("pointLedger").where("organizationId", "==", input.organizationId).orderBy(FieldPath.documentId()).limit(input.limit);
    if (input.checkpoint) query = query.startAfter(input.checkpoint);
    const page = await query.get(), totals: Totals = { participants: new Map(), teams: new Map() };
    for (const doc of page.docs) { const points = Number(doc.get("points")), quarterId = String(doc.get("quarterId")), participantId = String(doc.get("participantId")), teamId = String(doc.get("teamId") ?? ""); if (!Number.isSafeInteger(points)) throw new ConflictError("Ledger contains an invalid point amount."); add(totals.participants, `${quarterId}_${participantId}`, points); if (teamId) add(totals.teams, `${quarterId}_${teamId}`, points); }
    const nextCheckpoint = page.docs.at(-1)?.id ?? input.checkpoint ?? null, complete = page.size < input.limit;
    const variances = await this.variances(totals, input.generationId);
    if (!input.dryRun) {
      const batch = this.db.batch();
      batch.set(generationRef, { organizationId: input.organizationId, status: complete ? "built" : "building", checkpoint: nextCheckpoint, processed: FieldValue.increment(page.size), updatedAt: FieldValue.serverTimestamp(), createdBy: actor.uid }, { merge: true });
      for (const [id, totalPoints] of totals.participants) batch.set(this.db.doc(`aggregateGenerations/${input.generationId}/participantStats/${id}`), { totalPoints: FieldValue.increment(totalPoints) }, { merge: true });
      for (const [id, totalPoints] of totals.teams) batch.set(this.db.doc(`aggregateGenerations/${input.generationId}/teamStats/${id}`), { totalPoints: FieldValue.increment(totalPoints) }, { merge: true });
      batch.create(this.db.collection("auditLogs").doc(), { event: "POINT_AGGREGATES_RECONCILED", actorId: actor.uid, organizationId: input.organizationId, generationId: input.generationId, checkpoint: nextCheckpoint, complete, variances, createdAt: FieldValue.serverTimestamp() });
      await batch.commit();
      if (complete) await this.activate(actor.uid, input.organizationId, input.generationId);
    }
    return { generationId: input.generationId, dryRun: input.dryRun, processed: page.size, checkpoint: nextCheckpoint, complete, variances };
  }
  async rollback(principal: Principal | undefined, input: RollbackInput) {
    const actor = requireAdmin(principal); this.organization(actor.organizationIds, input.organizationId);
    const target = await this.db.doc(`aggregateGenerations/${input.generationId}`).get();
    if (!target.exists || target.get("organizationId") !== input.organizationId || !["active", "superseded"].includes(String(target.get("status")))) throw new NotFoundError();
    await this.activate(actor.uid, input.organizationId, input.generationId, input.reason);
    return { activeGenerationId: input.generationId };
  }
  private async activate(actorId: string, organizationId: string, generationId: string, reason?: string) {
    const pointer = this.db.doc(`aggregateGenerationPointers/${organizationId}`), target = this.db.doc(`aggregateGenerations/${generationId}`);
    await this.db.runTransaction(async tx => { const [old, generation] = await Promise.all([tx.get(pointer), tx.get(target)]); if (!generation.exists || generation.get("organizationId") !== organizationId || !["built", "active", "superseded"].includes(String(generation.get("status")))) throw new ConflictError("Generation is not ready for activation."); const previous = old.get("activeGenerationId") as string | undefined; if (previous && previous !== generationId) tx.set(this.db.doc(`aggregateGenerations/${previous}`), { status: "superseded", supersededAt: FieldValue.serverTimestamp() }, { merge: true }); tx.set(target, { status: "active", activatedAt: FieldValue.serverTimestamp() }, { merge: true }); tx.set(pointer, { organizationId, activeGenerationId: generationId, previousGenerationId: previous ?? null, activatedAt: FieldValue.serverTimestamp() }); tx.create(this.db.collection("auditLogs").doc(), { event: reason ? "POINT_AGGREGATE_ROLLBACK" : "POINT_AGGREGATE_ACTIVATED", actorId, organizationId, generationId, previousGenerationId: previous ?? null, reason: reason ?? null, createdAt: FieldValue.serverTimestamp() }); });
  }
  private async variances(totals: Totals, generationId: string) { const output: Array<{scope:string;id:string;expected:number;actual:number;variance:number}> = []; for (const [scope, values] of [["participant", totals.participants], ["team", totals.teams]] as const) for (const [id, delta] of values) { const target = await this.db.doc(`aggregateGenerations/${generationId}/${scope}Stats/${id}`).get(), expected = Number(target.get("totalPoints") ?? 0) + delta, live = await this.db.doc(`${scope}QuarterStats/${id}`).get(), actual = Number(live.get("totalPoints") ?? 0); if (actual !== expected) output.push({ scope, id, expected, actual, variance: actual - expected }); } return output; }
  private organization(ids: readonly string[], id: string) { if (!ids.includes(id)) throw new AuthorizationError(); }
}
const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value);
