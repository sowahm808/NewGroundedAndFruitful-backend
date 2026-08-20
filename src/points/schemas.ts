import { z } from "zod";
import { pointSourceTypes } from "./domain.js";
export const awardSchema = z
  .object({
    participantId: z.string().min(1).max(128),
    teamId: z.string().min(1).max(128),
    quarterId: z.string().min(1).max(128),
    sourceType: z
      .enum(pointSourceTypes)
      .refine((value) => value !== "adjustment", {
        message: "Adjustments require the administrator reversal workflow.",
      }),
    sourceId: z.string().min(1).max(128),
    reason: z.string().min(1).max(200),
    occurredAt: z.coerce.date(),
  })
  .strict();

const adjustmentReason = z.string().trim().min(3).max(500);

export const pointAdjustmentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("adjustment"),
      participantId: z.string().min(1).max(128),
      teamId: z.string().min(1).max(128),
      quarterId: z.string().min(1).max(128),
      points: z
        .number()
        .int()
        .safe()
        .refine((points) => points !== 0, {
          message: "An adjustment must change the point total.",
        }),
      reason: adjustmentReason,
      occurredAt: z.coerce.date(),
    })
    .strict(),
  z
    .object({
      type: z.literal("reversal"),
      originalEntryId: z.string().min(1).max(200),
      reason: adjustmentReason,
    })
    .strict(),
]);

export type PointAdjustmentInput = z.infer<typeof pointAdjustmentSchema>;

export const sourceAwardSchema = z.object({ participantId: z.string().min(1).max(128), sourceId: z.string().min(1).max(128) }).strict();
export const reconciliationSchema = z.object({ organizationId: z.string().min(1).max(128), generationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), dryRun: z.boolean(), limit: z.number().int().min(1).max(500).default(200), checkpoint: z.string().max(200).optional() }).strict();
export const reconciliationRollbackSchema = z.object({ organizationId: z.string().min(1).max(128), generationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), reason: z.string().trim().min(3).max(500) }).strict();
