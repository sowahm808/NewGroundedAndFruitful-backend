import { z } from "zod";
import { pointSourceTypes } from "./domain.js";
export const awardSchema = z
  .object({
    participantId: z.string().min(1).max(128),
    teamId: z.string().min(1).max(128),
    quarterId: z.string().min(1).max(128),
    sourceType: z.enum(pointSourceTypes),
    sourceId: z.string().min(1).max(128),
    reason: z.string().min(1).max(200),
    occurredAt: z.coerce.date(),
  })
  .strict();
