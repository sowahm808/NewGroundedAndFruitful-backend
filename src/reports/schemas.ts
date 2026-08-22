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

const paging = {
  organizationId: idSchema,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
};
export const reportDefinitionListQuerySchema = z
  .object({
    ...paging,
    sort: z.enum(["name", "-name", "updatedAt", "-updatedAt"]).default("name"),
    status: z.enum(["draft", "approved", "retired"]).optional(),
  })
  .strict();
export const reportJobListQuerySchema = z
  .object({
    ...paging,
    sort: z.enum(["createdAt", "-createdAt"]).default("-createdAt"),
    status: z
      .enum(["queued", "generating", "ready", "failed", "cancelled"])
      .optional(),
  })
  .strict();
export const reportActionSchema = z
  .object({ organizationId: idSchema })
  .strict();
