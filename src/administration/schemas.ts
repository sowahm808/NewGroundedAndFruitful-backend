import { z } from "zod";
import { canonicalRoleSchema } from "../auth/roles.js";
import { idSchema } from "../shared/validation.js";

const name = z.string().trim().min(1).max(120);
export const organizationCreateSchema = z
  .object({
    name,
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{3,50}$/),
  })
  .strict();
export const programCreateSchema = z
  .object({
    organizationId: idSchema,
    name,
    timezone: z.string().trim().min(1).max(80),
  })
  .strict();
export const membershipSchema = z
  .object({ userId: idSchema, role: canonicalRoleSchema })
  .strict();
export const parentOnboardingSchema = z
  .object({
    organizationId: idSchema,
    displayName: name,
    acceptedPrivacyVersion: z.string().trim().min(1).max(40),
  })
  .strict();
export const participantCreateSchema = z
  .object({
    organizationId: idSchema,
    programId: idSchema,
    displayName: name,
    birthDate: z.string().date(),
    guardianUserId: idSchema,
  })
  .strict();
export const participantUpdateSchema = z
  .object({ displayName: name.optional(), programId: idSchema.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const teamCreateSchema = z
  .object({ organizationId: idSchema, programId: idSchema, name })
  .strict();
export const teamUpdateSchema = z
  .object({
    name: name.optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const teamMemberSchema = z.object({ participantId: idSchema }).strict();
export const invitationCreateSchema = z
  .object({
    organizationId: idSchema,
    email: z.string().trim().email().max(254),
    role: z.enum(["mentor", "observer"]),
    expiresAt: z.string().datetime(),
  })
  .strict();
export const invitationDecisionSchema = z
  .object({ decision: z.enum(["approve", "revoke"]) })
  .strict();
export const consentCaptureSchema = z
  .object({
    organizationId: idSchema,
    participantId: idSchema,
    policyKey: z.string().trim().min(1).max(80),
    policyVersion: z.string().trim().min(1).max(40),
    granted: z.literal(true),
  })
  .strict();
export const roleUpdateSchema = z
  .object({
    role: canonicalRoleSchema,
    status: z.enum(["active", "suspended", "revoked"]),
  })
  .strict();
