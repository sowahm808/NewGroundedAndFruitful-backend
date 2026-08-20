import { z } from "zod";
import { idSchema } from "../shared/validation.js";
export const reportRequestSchema = z
  .object({
    organizationId: idSchema,
    participantId: idSchema,
    reportType: z.string().regex(/^[a-z0-9._-]{1,80}$/),
    policyVersion: z.string().min(1).max(40),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  })
  .strict();
