export const pointSourceTypes = [
  "daily_checkin",
  "gratitude",
  "character_assessment",
  "bible_activity",
  "family_activity",
  "reading",
  "project_milestone",
  "academic_session",
  "character_observation_bonus",
  "adjustment",
] as const;
export type PointSourceType = (typeof pointSourceTypes)[number];
export interface AwardRequest {
  participantId: string;
  teamId: string;
  quarterId: string;
  sourceType: PointSourceType;
  sourceId: string;
  reason: string;
  awardedBy: string;
  idempotencyKey: string;
  occurredAt: Date;
  /** Validated organization IANA timezone used for calendar aggregates. */
  timezone?: string;
}
export interface PointRule {
  activityType: Exclude<PointSourceType, "adjustment">;
  points: number;
  enabled: boolean;
  quarterId?: string;
  effectiveFrom: Date;
  effectiveUntil?: Date;
}
export interface PointLedgerEntry extends AwardRequest {
  id: string;
  points: number;
  createdAt: unknown;
  originalEntryId?: string;
}
export function completionAward(rule: PointRule, input: AwardRequest): number {
  if (!rule.enabled || rule.activityType !== input.sourceType) return 0;
  if (!Number.isSafeInteger(rule.points) || rule.points <= 0) return 0;
  if (
    input.occurredAt < rule.effectiveFrom ||
    (rule.effectiveUntil && input.occurredAt > rule.effectiveUntil)
  )
    return 0;
  return rule.points;
}
// Ratings, correctness, grades, scores and spiritual-performance data are deliberately absent.
