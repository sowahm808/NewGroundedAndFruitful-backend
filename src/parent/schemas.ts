import { z } from "zod";

export const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const optionalQueryString = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema,
  );

export const listSchema = z.object({
  limit: optionalQueryString(
    z.coerce.number().int().min(1).max(50).default(20),
  ),
  cursor: optionalQueryString(idSchema.optional()),
  status: optionalQueryString(
    z.enum(["active", "pending", "inactive"]).optional(),
  ),
  search: optionalQueryString(z.string().trim().min(1).max(80).optional()),
});
export const childQuerySchema = listSchema.pick({
  limit: true,
  cursor: true,
  status: true,
  search: true,
});
export const notificationQuerySchema = listSchema.pick({
  limit: true,
  cursor: true,
});
export const observationQuerySchema = listSchema.omit({ status: true }).extend({
  childId: optionalQueryString(idSchema.optional()),
  status: optionalQueryString(
    z.enum(["pending", "approved", "rejected"]).optional(),
  ),
});
export const supportListQuerySchema = listSchema.omit({ status: true }).extend({
  childId: optionalQueryString(idSchema.optional()),
  status: optionalQueryString(
    z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  ),
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

export const characterQuerySchema = z.object({
  childId: idSchema,
  quarterId: idSchema,
});
export const characterPatchSchema = characterSelectionSchema.extend({
  expectedVersion: z.number().int().min(0),
});
export const familyActivityQuerySchema = listSchema
  .pick({ limit: true, cursor: true, search: true })
  .extend({ childId: idSchema });
export const familyCompletionCommandSchema = z.object({ childId: idSchema });
export const reportQuerySchema = z.object({ childId: idSchema });
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
