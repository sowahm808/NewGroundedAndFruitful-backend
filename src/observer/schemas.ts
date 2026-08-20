import { z } from "zod";
import { idSchema } from "../shared/validation.js";
export const observationSchema = z
  .object({
    participantId: idSchema,
    subjectId: idSchema,
    observedAt: z.string().datetime(),
    description: z.string().trim().min(1).max(2000),
  })
  .strict();
export const historyQuerySchema = z
  .object({
    participantId: idSchema.optional(),
    status: z.enum(["pending", "approved", "rejected"]).optional(),
  })
  .strict();
