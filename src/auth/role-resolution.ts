import { normalizeRoles, type Role as UserRole } from "./roles.js";

export type AuthorizationSource = "membership" | "legacy_user_profile" | "none";

export interface RoleResolution<T> {
  roles: readonly UserRole[];
  source: AuthorizationSource;
  memberships: readonly T[];
  migrationRequired: boolean;
  invalidLegacyRoles: readonly string[];
}

/**
 * Resolves coarse roles without ever merging the migration field with memberships.
 * The presence of any membership record is an intentional fallback boundary,
 * including pending, suspended, revoked, and malformed records.
 */
export function resolveRoles<T extends { status: string; roles: readonly UserRole[] }>(
  memberships: readonly T[],
  legacyRoles: unknown,
  mode: "compatibility" | "strict",
): RoleResolution<T> {
  const active = memberships.filter((membership) => membership.status === "active");
  const activeRoles = [...new Set(active.flatMap((membership) => membership.roles))];
  if (activeRoles.length > 0)
    return { roles: activeRoles, source: "membership", memberships, migrationRequired: false, invalidLegacyRoles: [] };

  const legacy = normalizeRoles(legacyRoles);
  if (mode === "compatibility" && memberships.length === 0 && legacy.roles.length > 0)
    return { roles: legacy.roles, source: "legacy_user_profile", memberships, migrationRequired: true, invalidLegacyRoles: legacy.invalid };

  return { roles: [], source: "none", memberships, migrationRequired: false, invalidLegacyRoles: legacy.invalid };
}
