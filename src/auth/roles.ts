export const canonicalRoles = [
  "child",
  "parent",
  "mentor",
  "observer",
  "admin",
  "super_admin",
] as const;

export type Role = (typeof canonicalRoles)[number];

const aliases: Readonly<Record<string, Role>> = {
  child: "child",
  participant: "child",
  parent: "parent",
  guardian: "parent",
  mentor: "mentor",
  observer: "observer",
  authorizedadult: "observer",
  admin: "admin",
  administrator: "admin",
  superadmin: "super_admin",
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

export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (canonicalRoles as readonly string[]).includes(value)
  );
}
