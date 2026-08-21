import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { AuthenticationError, AuthorizationError } from "../shared/errors.js";
import type { Role } from "./roles.js";
import type { ActiveMembership } from "./policy.js";
import type { PlatformRole } from "./claims.js";
export type { Role } from "./roles.js";
export interface Principal {
  uid: string;
  role: Role;
  roles: readonly Role[];
  platformRoles?: readonly PlatformRole[];
  baseRoles?: readonly Role[];
  effectiveRoles?: readonly string[];
  capabilities?: readonly string[];
  activeWorkspaceId?: string;
  organizationIds: readonly string[];
  /** Populated by authentication; optional only for legacy internal call sites. */
  memberships?: readonly ActiveMembership[];
  authorizationSource?: "membership" | "legacy_user_profile";
  token: DecodedIdToken;
}
export function requireAuthenticated(
  principal: Principal | undefined,
): Principal {
  if (!principal) throw new AuthenticationError();
  return principal;
}
export function requireRole(p: Principal | undefined, role: Role): Principal {
  const a = requireAuthenticated(p);
  if (!a.roles.includes(role)) throw new AuthorizationError();
  return a;
}
export function requireAnyRole(
  p: Principal | undefined,
  roles: readonly Role[],
): Principal {
  const a = requireAuthenticated(p);
  if (!a.roles.some((role) => roles.includes(role)))
    throw new AuthorizationError();
  return a;
}
export const requireAdmin = (p: Principal | undefined) =>
  requireAnyRole(p, ["admin", "super_admin"]);
export const requireSuperAdmin = (p: Principal | undefined) =>
  requireRole(p, "super_admin");
export const requirePlatformSuperAdmin = (p: Principal | undefined) =>
  requireAuthenticated(p).platformRoles?.includes("super_admin")
    ? requireAuthenticated(p)
    : (() => {
        throw new AuthorizationError();
      })();

/** Membership documents are the sole source of tenant scope. */
export function requireOrganizationRole(
  p: Principal | undefined,
  organizationId: string,
  roles: readonly Role[],
): Principal {
  const actor = requireAuthenticated(p);
  const authorized = actor.memberships?.some(
    (membership) =>
      membership.userId === actor.uid &&
      membership.organizationId === organizationId &&
      membership.roles.some((role) => roles.includes(role)),
  );
  if (!authorized) throw new AuthorizationError();
  return actor;
}
export async function requireParentOf(
  db: Firestore,
  p: Principal | undefined,
  childId: string,
): Promise<void> {
  const a = requireRole(p, "parent");
  const link = await db.doc(`parentChildLinks/${a.uid}_${childId}`).get();
  if (
    !link.exists ||
    link.get("parentUid") !== a.uid ||
    link.get("participantId") !== childId ||
    link.get("status") !== "active" ||
    link.get("revokedAt") != null
  )
    throw new AuthorizationError();
  const organizationId = link.get("organizationId") as string | undefined;
  const participant = await db.doc(`participants/${childId}`).get();
  if (
    !participant.exists ||
    !organizationId ||
    participant.get("organizationId") !== organizationId ||
    !a.organizationIds.includes(organizationId)
  )
    throw new AuthorizationError();
}
export async function requireMentorOfTeam(
  db: Firestore,
  p: Principal | undefined,
  teamId: string,
): Promise<void> {
  const a = requireRole(p, "mentor");
  const membership = await db
    .doc(`teamMembers/${teamId}_mentor_${a.uid}`)
    .get();
  if (
    !membership.exists ||
    membership.get("userId") !== a.uid ||
    membership.get("teamId") !== teamId ||
    membership.get("role") !== "mentor" ||
    membership.get("status") !== "active"
  )
    throw new AuthorizationError();
  const organizationId = membership.get("organizationId") as string | undefined;
  if (organizationId && !a.organizationIds.includes(organizationId))
    throw new AuthorizationError();
}
export async function requireMentorOfChild(
  db: Firestore,
  p: Principal | undefined,
  childId: string,
): Promise<void> {
  const part = await db.doc(`participants/${childId}`).get();
  const teamId = part.get("activeTeamId") as string | undefined;
  if (!teamId) throw new AuthorizationError();
  const organizationId = part.get("organizationId") as string | undefined;
  const a = requireAuthenticated(p);
  if (organizationId && !a.organizationIds.includes(organizationId))
    throw new AuthorizationError();
  await requireMentorOfTeam(db, p, teamId);
}
export async function requireChildParticipant(
  db: Firestore,
  p: Principal | undefined,
  participantId: string,
): Promise<void> {
  const a = requireRole(p, "child");
  const participant = await db.doc(`participants/${participantId}`).get();
  if (!participant.exists || participant.get("firebaseUid") !== a.uid)
    throw new AuthorizationError();
  const organizationId = participant.get("organizationId") as
    | string
    | undefined;
  if (organizationId && !a.organizationIds.includes(organizationId))
    throw new AuthorizationError();
}
