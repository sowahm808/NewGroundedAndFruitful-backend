import { z } from "zod";
import { idSchema } from "../shared/validation.js";
import { notificationChannels } from "./domain.js";

export const preferenceSchema = z
  .object({
    organizationId: idSchema,
    channel: z.enum(notificationChannels),
    enabled: z.boolean(),
  })
  .strict();

export const enqueueNotificationSchema = z
  .object({
    organizationId: idSchema,
    recipientUserId: idSchema,
    channel: z.enum(notificationChannels),
    templateKey: z.string().regex(/^[a-z0-9._-]{1,80}$/),
    templateVersion: z.string().min(1).max(40),
    data: z.record(z.union([z.string().max(200), z.number(), z.boolean()])),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  })
  .strict();
