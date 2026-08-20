import type { DocumentSnapshot, Firestore, Timestamp, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { requireAnyRole, requireChildParticipant, requireMentorOfChild, requireParentOf, type Principal } from "../auth/authorization.js";
import { AuthorizationError, BusinessRuleError, ConflictError, NotFoundError } from "../shared/errors.js";
import { localWeekStart } from "../configuration/domain.js";
import type { CompletionSourceType } from "./domain.js";

export interface SourceAwardInput { participantId: string; sourceId: string }
type SourceDefinition = { collection: string; eligible: (source: DocumentSnapshot) => boolean };

const definitions: Record<CompletionSourceType, SourceDefinition> = {
  daily_checkin: { collection: "dailyCheckins", eligible: (s) => ["completed", "locked"].includes(String(s.get("status"))) },
  gratitude: { collection: "gratitudeEntries", eligible: () => true },
  character_assessment: { collection: "characterAssessments", eligible: (s) => ["completed", "locked"].includes(String(s.get("status"))) },
  bible_activity: { collection: "bibleActivityResponses", eligible: (s) => s.get("status") === "completed" },
  family_activity: { collection: "familyActivityCompletions", eligible: (s) => Boolean(s.get("completedAt")) },
  reading: { collection: "readingResponses", eligible: (s) => s.get("status") === "completed" },
  project_milestone: { collection: "projectMilestones", eligible: (s) => s.get("status") === "completed" },
  project_completion: { collection: "projects", eligible: (s) => s.get("status") === "completed" },
  academic_session: { collection: "academicSessions", eligible: (s) => s.get("status") === "completed" || Boolean(s.get("completedAt")) },
  character_observation_bonus: { collection: "characterObservations", eligible: (s) => s.get("status") === "approved" && s.get("pointBonusApproved") === true },
};

/** Trusted source boundary. Callers select a static source service, never a collection or arbitrary type. */
export class SourceCompletionService {
  constructor(private readonly db: Firestore, private readonly sourceType: CompletionSourceType, private readonly clock = () => new Date()) {}

  async record(principal: Principal | undefined, input: SourceAwardInput, idempotencyKey: string) {
    const actor = requireAnyRole(principal, ["child", "parent", "mentor", "admin", "super_admin"]);
    const definition = definitions[this.sourceType];
    return this.db.runTransaction(async (tx) => {
      const ledgerRef = this.db.doc(`pointLedger/${idempotencyKey}`);
      const old = await tx.get(ledgerRef);
      if (old.exists) {
        if (old.get("operationFingerprint") !== fingerprint(this.sourceType, input, actor.uid)) throw new ConflictError("Idempotency key was already used for another operation.");
        return { entry: { ...old.data(), id: old.id } as Record<string, unknown> & { id: string; points: number }, created: false };
      }
      const [source, participant] = await Promise.all([
        tx.get(this.db.doc(`${definition.collection}/${input.sourceId}`)),
        tx.get(this.db.doc(`participants/${input.participantId}`)),
      ]);
      if (!source.exists || !participant.exists) throw new NotFoundError();
      await this.authorize(actor, input.participantId);
      const organizationId = requiredString(participant, "organizationId");
      if (!actor.organizationIds.includes(organizationId)) throw new AuthorizationError();
      const quarterId = requiredString(source, "quarterId");
      const teamId = String(participant.get("activeTeamId") ?? participant.get("teamId") ?? "");
      if (!teamId || source.get("participantId") !== input.participantId || source.get("organizationId") !== organizationId) throw new AuthorizationError();
      const [team, quarter, organization] = await Promise.all([
        tx.get(this.db.doc(`teams/${teamId}`)), tx.get(this.db.doc(`quarters/${quarterId}`)), tx.get(this.db.doc(`organizations/${organizationId}`)),
      ]);
      if (!team.exists || !quarter.exists || !organization.exists || team.get("organizationId") !== organizationId || quarter.get("organizationId") !== organizationId) throw new AuthorizationError();
      if (!definition.eligible(source)) throw new BusinessRuleError("SOURCE_INELIGIBLE", "The source record is not eligible for points.");
      const occurredAt = sourceInstant(source, this.clock());
      const rules = await tx.get(this.db.collection("pointRules").where("organizationId", "==", organizationId).where("sourceType", "==", this.sourceType).where("status", "==", "active"));
      const eligible = rules.docs.filter((r) => (!r.get("quarterId") || r.get("quarterId") === quarterId) && inEffect(r, occurredAt));
      if (eligible.length !== 1) throw new BusinessRuleError("POINT_RULE_INELIGIBLE", eligible.length ? "Multiple effective point rules are configured." : "No effective point rule is configured.");
      const rule = eligible[0]!, points = Number(rule.get("points")), version = Number(rule.get("version"));
      if (!Number.isSafeInteger(points) || points <= 0 || !Number.isSafeInteger(version) || version <= 0) throw new BusinessRuleError("POINT_RULE_INVALID", "The effective point rule is invalid.");
      const completionRef = this.db.doc(`sourceCompletions/${idempotencyKey}`);
      const evaluationFacts = { sourceCollection: definition.collection, sourceStatus: source.get("status") ?? null, organizationId, quarterId, participantId: input.participantId, teamId, occurredAt };
      const entry = { id: ledgerRef.id, idempotencyKey, operationFingerprint: fingerprint(this.sourceType, input, actor.uid), participantId: input.participantId, teamId, quarterId, organizationId, sourceType: this.sourceType, sourceId: input.sourceId, awardedBy: actor.uid, occurredAt, points, ruleId: rule.id, ruleVersion: version, ruleAmount: points, evaluationFacts, createdAt: FieldValue.serverTimestamp() };
      tx.create(completionRef, { ...entry, id: completionRef.id, ledgerEntryId: ledgerRef.id });
      tx.create(ledgerRef, entry);
      this.aggregates(tx, entry, String(organization.get("timezone") ?? "UTC"));
      return { entry, created: true };
    });
  }

  private async authorize(actor: Principal, participantId: string) {
    if (actor.role === "child") return requireChildParticipant(this.db, actor, participantId);
    if (actor.role === "parent") return requireParentOf(this.db, actor, participantId);
    if (actor.role === "mentor") return requireMentorOfChild(this.db, actor, participantId);
  }
  private aggregates(tx: Transaction, entry: {participantId:string;teamId:string;quarterId:string;organizationId:string;points:number;occurredAt:Date}, timezone:string) {
    const increment = FieldValue.increment(entry.points), updatedAt = FieldValue.serverTimestamp();
    tx.set(this.db.doc(`participantQuarterStats/${entry.quarterId}_${entry.participantId}`), { organizationId: entry.organizationId, participantId: entry.participantId, quarterId: entry.quarterId, totalPoints: increment, updatedAt }, { merge: true });
    tx.set(this.db.doc(`teamQuarterStats/${entry.quarterId}_${entry.teamId}`), { organizationId: entry.organizationId, teamId: entry.teamId, quarterId: entry.quarterId, totalPoints: increment, updatedAt }, { merge: true });
    const week = localWeekStart(entry.occurredAt, timezone);
    tx.set(this.db.doc(`teamWeeklyStats/${entry.quarterId}_${entry.teamId}_${week}`), { organizationId: entry.organizationId, teamId: entry.teamId, quarterId: entry.quarterId, week, totalPoints: increment, updatedAt }, { merge: true });
  }
}

const fingerprint = (type: string, input: SourceAwardInput, actor: string) => createHash("sha256").update(JSON.stringify({ type, ...input, actor })).digest("hex");
const requiredString = (snap: DocumentSnapshot, field: string) => { const value = snap.get(field); if (typeof value !== "string" || !value) throw new BusinessRuleError("SOURCE_INVALID", `The source ${field} is invalid.`); return value; };
const sourceInstant = (snap: DocumentSnapshot, fallback: Date) => { for (const field of ["completedAt", "occurredAt", "createdAt"]) { const value = snap.get(field) as Timestamp | Date | undefined; if (value instanceof Date) return value; if (value && typeof value.toDate === "function") return value.toDate(); } return fallback; };
const inEffect = (rule: DocumentSnapshot, instant: Date) => { const from = rule.get("effectiveFrom") as Timestamp | undefined, until = rule.get("effectiveUntil") as Timestamp | undefined; return (!from || from.toMillis() <= instant.getTime()) && (!until || until.toMillis() >= instant.getTime()); };
