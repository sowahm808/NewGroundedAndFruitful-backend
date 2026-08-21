import { z } from "zod";

export const canonicalRoles = [
  "child",
  "parent",
  "mentor",
  "observer",
  "owner",
  "admin",
  "super_admin",
  "platform_super_admin",
] as const;

export type Role = (typeof canonicalRoles)[number];
export const canonicalRoleSchema = z.enum(canonicalRoles);
export const canonicalRoleArraySchema = z.array(canonicalRoleSchema);

const aliases: Readonly<Record<string, Role>> = {
  child: "child",
  participant: "child",
  parent: "parent",
  guardian: "parent",
  mentor: "mentor",
  observer: "observer",
  owner: "owner",
  authorizedadult: "observer",
  admin: "admin",
  administrator: "admin",
  superadmin: "super_admin",
  platformsuperadmin: "platform_super_admin",
};

/** Normalizes persisted roles. Unknown values are returned for safe diagnostics. */
export function normalizeRoles(value: unknown): {
  roles: Role[];
  invalid: string[];
} {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const roles: Role[] = [];
  const invalid: string[] = [];
  for (const stored of values) {
    if (typeof stored !== "string") {
      invalid.push(typeof stored);
      continue;
    }
    const trimmed = stored.trim();
    const role = aliases[trimmed.toLowerCase().replace(/[-_\s]/g, "")];
    if (!role) {
      invalid.push(trimmed.slice(0, 64));
      continue;
    }
    if (!roles.includes(role)) roles.push(role);
  }
  return { roles, invalid };
}

/** Validates a server-controlled role array without accepting legacy aliases. */
export function parseCanonicalRoles(value: unknown): Role[] {
  return canonicalRoleArraySchema.parse(value);
}

export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (canonicalRoles as readonly string[]).includes(value)
  );
}
