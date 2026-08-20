import { z } from "zod";
import { canonicalRoleSchema } from "../auth/roles.js";
import { idSchema } from "../shared/validation.js";

const name = z.string().trim().min(1).max(120);
export const userListQuerySchema = z
  .object({
    organizationId: idSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(25),
    sort: z.enum(["updatedAt", "-updatedAt"]).default("-updatedAt"),
  })
  .strict();
export const membershipListQuerySchema = z
  .object({
    organizationId: idSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(25),
    sort: z.enum(["updatedAt", "-updatedAt"]).default("-updatedAt"),
  })
  .strict();
// Roles are represented by membership records, so both administration list
// endpoints intentionally accept the same filtering and pagination contract.
export const roleListQuerySchema = membershipListQuerySchema;
export const resourceListQuerySchema = z
  .object({
    organizationId: idSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(25),
    sort: z.enum(["updatedAt", "-updatedAt"]).default("-updatedAt"),
  })
  .strict();
export const ianaTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Must be a valid IANA timezone.");
export const organizationCreateSchema = z
  .object({
    name,
    timezone: ianaTimezoneSchema,
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{3,50}$/),
  })
  .strict();
export const versionSchema = z.number().int().positive();
export const lifecycleVersionSchema = z
  .object({ version: versionSchema })
  .strict();
export const organizationUpdateSchema = z
  .object({
    name: name.optional(),
    timezone: ianaTimezoneSchema.optional(),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{3,50}$/)
      .optional(),
    version: versionSchema,
  })
  .strict();
export const programCreateSchema = z
  .object({
    organizationId: idSchema,
    name,
    timezone: ianaTimezoneSchema,
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
    consentStatus: z.enum(["pending", "granted", "declined"]),
    participantId: idSchema.optional(),
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
  .object({
    displayName: name.optional(),
    programId: idSchema.optional(),
    firebaseUid: idSchema.optional(),
    version: versionSchema,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const teamCreateSchema = z
  .object({
    organizationId: idSchema,
    programId: idSchema,
    name,
    capacity: z.number().int().positive().max(1000),
  })
  .strict();
export const teamUpdateSchema = z
  .object({
    name: name.optional(),
    status: z.enum(["active", "archived"]).optional(),
    capacity: z.number().int().positive().max(1000).optional(),
    version: versionSchema,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const teamMemberSchema = z.object({ participantId: idSchema }).strict();
export const teamMentorSchema = z
  .object({ userId: idSchema, expiresAt: z.string().datetime().optional() })
  .strict();
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
    legalTextReference: z.string().trim().url().max(500),
    granted: z.literal(true),
  })
  .strict();
export const roleUpdateSchema = z
  .object({
    role: canonicalRoleSchema,
    status: z.enum(["active", "suspended", "revoked"]),
    version: versionSchema.optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();
export const relationshipSchema = z
  .object({
    organizationId: idSchema,
    participantId: idSchema.optional(),
    teamId: idSchema.optional(),
    userId: idSchema,
    type: z.enum(["parent", "observer"]),
    status: z.enum(["pending", "active"]).default("pending"),
    effectiveAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.participantId), "participantId is required");
export const resourceCreateSchema = z
  .object({
    organizationId: idSchema,
    name: name.optional(),
    data: z.record(z.unknown()).default({}),
  })
  .strict();
export const resourceLifecycleSchema = z
  .object({ version: versionSchema })
  .strict();

export const quarterStatuses = [
  "draft",
  "active",
  "closed",
  "archived",
] as const;
export const quarterSorts = [
  "updated_desc",
  "updated_asc",
  "start_date_desc",
  "start_date_asc",
] as const;
const quarterSortAliases = {
  "-updatedAt": "updated_desc",
  updatedAt: "updated_asc",
  "-startDate": "start_date_desc",
  startDate: "start_date_asc",
} as const;
const quarterName = z.string().trim().min(1).max(120);
const quarterDate = z.string().date();
export const quarterListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(quarterStatuses).optional(),
    sort: z
      .union([
        z.enum(quarterSorts),
        z.enum(["-updatedAt", "updatedAt", "-startDate", "startDate"]),
      ])
      .transform((sort) =>
        sort in quarterSortAliases
          ? quarterSortAliases[sort as keyof typeof quarterSortAliases]
          : (sort as (typeof quarterSorts)[number]),
      )
      .default("updated_desc"),
    search: z.string().trim().max(120).optional(),
    organizationId: idSchema.optional(),
  })
  .strict();
export const quarterCreateSchema = z
  .object({
    name: quarterName,
    description: z.string().trim().max(2000).nullable().optional(),
    startDate: quarterDate.optional(),
    endDate: quarterDate.optional(),
    startsOn: quarterDate.optional(),
    endsOn: quarterDate.optional(),
    organizationId: idSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const canonicalDates =
      value.startDate !== undefined || value.endDate !== undefined;
    const dateAliases =
      value.startsOn !== undefined || value.endsOn !== undefined;
    if (canonicalDates && dateAliases) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either startDate/endDate or startsOn/endsOn, not both.",
      });
      return;
    }
    for (const field of canonicalDates
      ? (["startDate", "endDate"] as const)
      : (["startsOn", "endsOn"] as const)) {
      if (value[field] === undefined)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: "Required",
        });
    }
  })
  .transform(({ startsOn, endsOn, ...value }) => ({
    ...value,
    startDate: value.startDate ?? (startsOn as string),
    endDate: value.endDate ?? (endsOn as string),
  }));
export const quarterUpdateSchema = z
  .object({
    name: quarterName.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    startDate: quarterDate.optional(),
    endDate: quarterDate.optional(),
    expectedVersion: versionSchema,
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedVersion"),
    {
      message: "At least one editable field is required.",
    },
  );
export const quarterLifecycleSchema = z
  .object({ expectedVersion: versionSchema })
  .strict();
export const awardIssueSchema = z
  .object({
    organizationId: idSchema,
    participantId: idSchema,
    awardDefinitionId: idSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
