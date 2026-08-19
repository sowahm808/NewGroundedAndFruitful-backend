import type { Firestore, Timestamp } from "firebase-admin/firestore";
import {
  requireMentorOfChild,
  requireParentOf,
  requireAnyRole,
  requireChildParticipant,
  type Principal,
} from "../auth/authorization.js";
import {
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
} from "../shared/errors.js";
import type { AwardRequest, PointRule } from "./domain.js";
import { completionAward } from "./domain.js";
import { PointRepository } from "./repository.js";
export class CompletionService {
  constructor(
    private db: Firestore,
    private points: PointRepository,
  ) {}
  async record(
    principal: Principal | undefined,
    input: Omit<AwardRequest, "awardedBy" | "idempotencyKey">,
    key: string,
  ) {
    const p = requireAnyRole(principal, [
      "child",
      "parent",
      "mentor",
      "admin",
      "super_admin",
    ]);
    const participant = await this.db
      .doc(`participants/${input.participantId}`)
      .get();
    if (!participant.exists) throw new NotFoundError();
    if (participant.get("activeTeamId") !== input.teamId)
      throw new AuthorizationError();
    if (p.role === "child")
      await requireChildParticipant(this.db, p, input.participantId);
    if (p.role === "parent")
      await requireParentOf(this.db, p, input.participantId);
    if (p.role === "mentor")
      await requireMentorOfChild(this.db, p, input.participantId);
    const snap = await this.db
      .doc(`pointRules/${input.quarterId}_${input.sourceType}`)
      .get();
    if (!snap.exists)
      throw new BusinessRuleError(
        "POINT_RULE_INELIGIBLE",
        "This completion is not eligible for points.",
      );
    const data = snap.data() as {
      points: number;
      enabled: boolean;
      effectiveFrom: Timestamp;
      effectiveUntil?: Timestamp;
    };
    const rule: PointRule = {
      activityType: input.sourceType as PointRule["activityType"],
      points: data.points,
      enabled: data.enabled,
      effectiveFrom: data.effectiveFrom.toDate(),
      ...(data.effectiveUntil
        ? { effectiveUntil: data.effectiveUntil.toDate() }
        : {}),
      quarterId: input.quarterId,
    };
    const points = completionAward(rule, {
      ...input,
      awardedBy: p.uid,
      idempotencyKey: key,
    });
    if (points <= 0)
      throw new BusinessRuleError(
        "POINT_RULE_INELIGIBLE",
        "This completion is not eligible for points.",
      );
    return this.points.award(
      { ...input, awardedBy: p.uid, idempotencyKey: key },
      points,
    );
  }
}
