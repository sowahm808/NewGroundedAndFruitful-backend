import { z } from "zod";
import { canonicalRoleSchema } from "../auth/roles.js";
import { idSchema } from "../shared/validation.js";

const name = z.string().trim().min(1).max(120);
export const versionSchema = z.number().int().positive();
export const lifecycleVersionSchema = z
  .object({ version: versionSchema })
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

// -------------------------------------------------------------
// User, Membership & Role Schemas
// -------------------------------------------------------------
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

export const roleListQuerySchema = membershipListQuerySchema;

export const membershipSchema = z
  .object({ userId: idSchema, role: canonicalRoleSchema })
  .strict();

export const roleUpdateSchema = z
  .object({
    role: canonicalRoleSchema,
    status: z.enum(["active", "suspended", "revoked"]),
    version: versionSchema.optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();

// -------------------------------------------------------------
// Organization & Program Schemas
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// Resource & Participant Schemas
// -------------------------------------------------------------
export const resourceListQuerySchema = z
  .object({
    organizationId: idSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(25),
    status: z.string().trim().optional(),
    quarterId: idSchema.optional(),
    search: z.string().trim().max(120).optional(),
    sort: z
      .enum([
        "updatedAt",
        "-updatedAt",
        "updatedAt_desc",
        "updatedAt_asc",
        "createdAt",
        "-createdAt",
        "createdAt_desc",
        "createdAt_asc",
        "name",
        "-name",
        "name_asc",
        "name_desc",
      ])
      .default("-updatedAt")
      .transform((val): "-updatedAt" | "updatedAt" => {
        switch (val) {
          case "updatedAt":
          case "updatedAt_asc":
          case "createdAt":
          case "createdAt_asc":
          case "name":
          case "name_asc":
            return "updatedAt";
          default:
            return "-updatedAt";
        }
      }),
  })
  .strict();

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

export const participantListQuerySchema = z
  .object({
    organizationId: idSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(25),
    search: z.string().trim().min(1).max(120).optional(),
    status: idSchema.optional(),
    teamId: idSchema.optional(),
    programId: idSchema.optional(),
    sort: z
      .enum([
        "updatedAt",
        "-updatedAt",
        "updatedAt_desc",
        "updatedAt_asc",
        "createdAt",
        "-createdAt",
        "createdAt_desc",
        "createdAt_asc",
        "name",
        "-name",
        "name_desc",
        "name_asc",
      ])
      .default("-updatedAt")
      .transform((val): "-updatedAt" | "updatedAt" => {
        switch (val) {
          case "updatedAt":
          case "updatedAt_asc":
          case "createdAt":
          case "createdAt_asc":
          case "name":
          case "name_asc":
            return "updatedAt";
          default:
            return "-updatedAt";
        }
      }),
  })
  .strict();

export const participantCreateSchema = z.object({
  organizationId: idSchema.optional(),
  programId: idSchema.optional(),
  displayName: name,
  handle: z.string().trim().min(2).max(40).optional(),
  birthDate: z.string().optional().default("2015-01-01"),
  guardianUserId: idSchema.optional(),
  activeTeamId: idSchema.optional(),
  status: z.enum(["pending", "active", "withdrawn"]).default("active"),
});

export const participantUpdateSchema = z
  .object({
    displayName: name.optional(),
    programId: idSchema.optional(),
    firebaseUid: idSchema.optional(),
    version: versionSchema,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);

// -------------------------------------------------------------
// Team Schemas
// -------------------------------------------------------------
export const teamCreateSchema = z
  .object({
    organizationId: idSchema,
    name,
    displayName: name.optional(),
    approvedDisplayName: name.optional(),
    programId: idSchema.optional().nullable(),
    quarterId: idSchema.optional().nullable(),
    capacity: z.coerce.number().int().positive().max(1000).default(5),
    targetPoints: z.coerce.number().int().min(100).default(5000),
  })
  .strict();

export type TeamCreateInput = z.infer<typeof teamCreateSchema>;

export const teamUpdateSchema = z
  .object({
    name: name.optional(),
    displayName: name.optional(),
    approvedDisplayName: name.optional(),
    programId: idSchema.optional().nullable(),
    quarterId: idSchema.optional().nullable(),
    status: z.enum(["active", "archived"]).optional(),
    capacity: z.coerce.number().int().positive().max(1000).optional(),
    targetPoints: z.coerce.number().int().min(100).optional(),
    version: versionSchema,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, {
    message: "At least one editable field besides version is required.",
  });

export type TeamUpdateInput = z.infer<typeof teamUpdateSchema>;

export const teamListQuerySchema = z
  .object({
    organizationId: idSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(25),
    status: z.enum(["active", "archived"]).optional(),
    search: z.string().trim().max(100).optional(),
    sort: z
      .enum([
        "updatedAt",
        "-updatedAt",
        "updatedAt_desc",
        "updatedAt_asc",
        "name",
        "-name",
        "name_asc",
        "name_desc",
      ])
      .default("-updatedAt")
      .transform((val): "-updatedAt" | "updatedAt" => {
        switch (val) {
          case "updatedAt":
          case "updatedAt_asc":
          case "name":
          case "name_asc":
            return "updatedAt";
          default:
            return "-updatedAt";
        }
      }),
  })
  .strict();

export type TeamListQueryInput = z.infer<typeof teamListQuerySchema>;

export const teamMemberSchema = z.object({ participantId: idSchema }).strict();
export const teamMentorSchema = z
  .object({ userId: idSchema, expiresAt: z.string().datetime().optional() })
  .strict();

// -------------------------------------------------------------
// Parent, Invitation, Consent & Relationship Schemas
// -------------------------------------------------------------
export const parentOnboardingSchema = z
  .object({
    organizationId: idSchema,
    displayName: name,
    acceptedPrivacyVersion: z.string().trim().min(1).max(40),
    consentStatus: z.enum(["pending", "granted", "declined"]),
    participantId: idSchema.optional(),
  })
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

export const awardIssueSchema = z
  .object({
    organizationId: idSchema,
    participantId: idSchema,
    awardDefinitionId: idSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

// -------------------------------------------------------------
// Quarter Schemas (Required by quarters.ts & tests)
// -------------------------------------------------------------
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