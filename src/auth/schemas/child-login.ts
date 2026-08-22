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
    // Provisioning and rotation only issue six-digit PINs. Keeping this exact at
    // the public boundary avoids doing expensive Argon2 work for malformed input.
    pin: z.string().regex(/^\d{6}$/),
  })
  .strict();
export type ChildLogin = z.infer<typeof childLoginSchema>;
