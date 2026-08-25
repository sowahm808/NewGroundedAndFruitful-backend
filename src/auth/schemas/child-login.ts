import { z } from "zod";
import { normalizeCredentialPart } from "../repositories/child-credentials.js";
export const childLoginSchema = z
  .object({
    familyCode: z
      .string()
      .transform(normalizeCredentialPart)
      .pipe(
        z
          .string()
          .min(3)
          .max(128)
          .regex(/^[a-z0-9._-]+$/),
      ),
    handle: z
      .string()
      .transform(normalizeCredentialPart)
      .pipe(
        z
          .string()
          .min(2)
          .max(80)
          .regex(/^[a-z0-9][a-z0-9._-]*$/),
      ),
    pin: z.string().regex(/^\d{4,6}$/),
  })
  .strict();
export type ChildLogin = z.infer<typeof childLoginSchema>;

export const participantChildLoginSchema = z
  .object({
    familyCode: z.string().trim().min(1).max(128),
    handle: z
      .string()
      .transform(normalizeCredentialPart)
      .pipe(z.string().min(1).max(80)),
    pin: z
      .string()
      .trim()
      .regex(/^\d{4,6}$/),
  })
  .strict();
export type ParticipantChildLogin = z.infer<typeof participantChildLoginSchema>;
