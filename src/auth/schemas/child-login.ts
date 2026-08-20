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
          .min(8)
          .max(24)
          .regex(/^[a-z0-9_-]+$/),
      ),
    handle: z
      .string()
      .transform(normalizeCredentialPart)
      .pipe(
        z
          .string()
          .min(2)
          .max(24)
          .regex(/^[a-z0-9][a-z0-9._-]*$/),
      ),
    pin: z.string().min(4).max(128),
  })
  .strict();
export type ChildLogin = z.infer<typeof childLoginSchema>;
