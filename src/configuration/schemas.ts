import { z } from "zod";
import {
  ianaTimezoneSchema,
  versionSchema,
} from "../administration/schemas.js";
import { idSchema } from "../shared/validation.js";
import { quarterStates } from "./domain.js";

const localDate = z.string().date();
export const quarterCreateSchema = z
  .object({
    organizationId: idSchema,
    programId: idSchema,
    name: z.string().trim().min(1).max(120),
    startDate: localDate,
    endDate: localDate,
    targetPoints: z.number().int().nonnegative(),
  })
  .strict();
export const quarterTransitionSchema = z
  .object({ state: z.enum(quarterStates), version: versionSchema })
  .strict();
export const characterCycleCreateSchema = z
  .object({
    organizationId: idSchema,
    quarterId: idSchema,
    participantId: idSchema.optional(),
    startDate: localDate,
    endDate: localDate,
    qualityIds: z
      .array(idSchema)
      .length(5)
      .refine((ids) => new Set(ids).size === 5, "Quality IDs must be unique."),
  })
  .strict();
export const contentAssignmentCreateSchema = z
  .object({
    organizationId: idSchema,
    quarterId: idSchema,
    contentType: z.enum([
      "bible",
      "reading",
      "family_activity",
      "special_activity",
      "survey",
    ]),
    contentId: idSchema,
    startDate: localDate,
    endDate: localDate,
    participantIds: z.array(idSchema).max(1000).default([]),
    teamIds: z.array(idSchema).max(1000).default([]),
  })
  .strict();
export const pointRuleVersionCreateSchema = z
  .object({
    organizationId: idSchema,
    quarterId: idSchema,
    sourceType: z.string().trim().min(1).max(80),
    points: z.number().int().positive(),
    effectiveStartDate: localDate,
    effectiveEndDate: localDate,
  })
  .strict();
export { ianaTimezoneSchema };
