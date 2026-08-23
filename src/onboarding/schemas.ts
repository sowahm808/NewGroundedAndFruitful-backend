import { z } from "zod";

/**
 * The bootstrap contract deliberately has no authority-bearing fields. Identity,
 * roles, workspace ownership, lifecycle state, and audit data are server-owned.
 */
export const organizationBootstrapSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{3,50}$/),
    timezone: z.string().trim().min(1).max(80),
  })
  .strict();

/** Only local-calendar configuration is accepted; identity and authority are server-owned. */
export const personalWorkspaceBootstrapSchema = z
  .object({ timezone: z.string().trim().min(1).max(80) })
  .strict();

export const legacyOrganizationRepairSchema = z
  .object({ targetUid: z.string().trim().min(1).max(128).optional() })
  .strict();
