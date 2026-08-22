import { z } from "zod";
import { idSchema } from "../shared/validation.js";

export const mentorTeamQuerySchema = z
  .object({
    quarterId: idSchema.optional(),
  })
  .strict();
export const mentorParticipantQuerySchema = z
  .object({
    participantId: idSchema,
    quarterId: idSchema.optional(),
  })
  .strict();
export const guidanceSchema = z
  .object({
    participantId: idSchema,
    projectId: idSchema,
    message: z.string().trim().min(1).max(2000),
  })
  .strict();
export const encouragementSchema = z
  .object({
    participantId: idSchema,
    message: z.string().trim().min(1).max(500),
  })
  .strict();
export const noteSchema = z
  .object({
    participantId: idSchema,
    body: z.string().trim().min(1).max(2000),
  })
  .strict();
