import { z } from "zod";

export const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const emptyQueryParameterAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema,
  );

export const listSchema = z.object({
  limit: emptyQueryParameterAsUndefined(
    z.coerce.number().int().min(1).max(50).default(20),
  ),
  cursor: emptyQueryParameterAsUndefined(
    z.string().trim().min(1).max(500).optional(),
  ),
  status: emptyQueryParameterAsUndefined(
    z.enum(["active", "pending", "inactive"]).optional(),
  ),
  search: emptyQueryParameterAsUndefined(z.string().trim().max(80).optional()),
});
export const childQuerySchema = listSchema.pick({
  limit: true,
  cursor: true,
  status: true,
  search: true,
});
export const observationSchema = z.object({
  childId: idSchema,
  qualityId: idSchema.optional(),
  description: z.string().trim().min(20).max(2000),
  observedAt: z.string().datetime(),
});
export const characterSelectionSchema = z.object({
  childId: idSchema,
  quarterId: idSchema,
  qualityIds: z
    .array(idSchema)
    .length(5)
    .refine((ids) => new Set(ids).size === 5, "Qualities must be unique"),
});
export const familyCompletionSchema = z.object({
  childId: idSchema,
  activityId: idSchema,
});
export const supportRequestSchema = z.object({
  childId: idSchema,
  categoryId: idSchema,
  subject: z.string().trim().min(3).max(120),
  description: z.string().trim().min(20).max(2000),
});
