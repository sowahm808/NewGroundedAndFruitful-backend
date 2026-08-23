import { z } from "zod";
import { canonicalRoleSchema } from "../auth/roles.js";
import { idSchema } from "../shared/validation.js";

const name = z.string().trim().min(1).max(120);
export const versionSchema = z.number().int().positive();
export const lifecycleVersionSchema = z.object({ version: versionSchema }).strict();

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

export const userListQuerySchema = z
  .object({
    organizationId: idSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(25),
    sort: z.enum(["updatedAt", "-updatedAt"]).default("-updatedAt"),
  })
  .strict();

export const membershipListQuerySchema = userListQuerySchema;
export const roleListQuerySchema = membershipListQuerySchema;