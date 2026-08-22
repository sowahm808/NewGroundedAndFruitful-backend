import type { Auth, UserRecord } from "firebase-admin/auth";
import { normalizeRoles, type Role } from "./roles.js";

export type PlatformRole = "super_admin";

const platformRoleAllowlist = new Set<PlatformRole>(["super_admin"]);
const preservedClaimKeys = new Set([
  "environment",
  "version",
  "sessionVersion",
  "featureFlags",
  "theme",
]);

export function normalizePlatformRoles(value: unknown): PlatformRole[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [
    ...new Set(
      values.filter(
        (role): role is PlatformRole =>
          typeof role === "string" &&
          platformRoleAllowlist.has(role as PlatformRole),
      ),
    ),
  ];
}

/**
 * Accept explicit platformRoles, or the legacy super_admin claim only when the
 * independently server-managed profile corroborates the grant.
 */
export function trustedPlatformRoles(
  claims: Readonly<Record<string, unknown>>,
  profileRoles: unknown,
): PlatformRole[] {
  const explicit = normalizePlatformRoles(claims.platformRoles);
  const profile = normalizeRoles(profileRoles).roles;
  const legacy = normalizeRoles(claims.roles).roles;
  if (
    explicit.includes("super_admin") ||
    (legacy.includes("super_admin") && profile.includes("super_admin"))
  )
    return ["super_admin"];
  return [];
}

export function effectiveRoles(
  platformRoles: readonly PlatformRole[],
  membershipRoles: readonly Role[],
): Role[] {
  return [...new Set<Role>([...platformRoles, ...membershipRoles])];
}

export function authorizedClaims(
  current: Readonly<Record<string, unknown>>,
  platformRoles: readonly PlatformRole[],
  roles: readonly Role[],
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const key of preservedClaimKeys)
    if (Object.prototype.hasOwnProperty.call(current, key))
      next[key] = current[key];
  next.platformRoles = [...platformRoles];
  next.roles = [...roles];
  return next;
}

export function claimsEqual(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  return JSON.stringify(sortValue(left)) === JSON.stringify(sortValue(right));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return [...value].sort();
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  return value;
}

/** Refetches immediately before writing so parallel synchronizers merge from fresh state. */
export async function synchronizeClaims(
  auth: Auth,
  uid: string,
  calculate: (user: UserRecord) => Record<string, unknown>,
): Promise<{
  changed: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}> {
  const fresh = await auth.getUser(uid);
  const before = fresh.customClaims ?? {};
  const after = calculate(fresh);
  if (claimsEqual(before, after)) return { changed: false, before, after };
  await auth.setCustomUserClaims(uid, after);
  return { changed: true, before, after };
}
