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

// src/points/schemas.ts

export const reconciliationSchema = z
  .object({
    quarterId: z.string().min(1).max(128),
    participantId: z.string().min(1).max(128).optional(),
    teamId: z.string().min(1).max(128).optional(),
    dryRun: z.boolean().default(false),
    batchSize: z.number().int().positive().max(1000).optional(),
    reason: adjustmentReason.optional(),
  })
  .strict();

export const reconciliationRollbackSchema = z
  .object({
    generationId: z.string().min(1).max(128),
    quarterId: z.string().min(1).max(128),
    reason: adjustmentReason,
  })
  .strict();

export type ReconciliationInput = z.infer<typeof reconciliationSchema>;
export type ReconciliationRollbackInput = z.infer<typeof reconciliationRollbackSchema>;
export type PointAdjustmentInput = z.infer<typeof pointAdjustmentSchema>;
