import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { AuthenticationError, AuthorizationError } from "../shared/errors.js";
export type Role =
  | "child"
  | "parent"
  | "mentor"
  | "observer"
  | "admin"
  | "super_admin";
export interface Principal {
  uid: string;
  role: Role;
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
  if (a.role !== role) throw new AuthorizationError();
  return a;
}
export function requireAnyRole(
  p: Principal | undefined,
  roles: readonly Role[],
): Principal {
  const a = requireAuthenticated(p);
  if (!roles.includes(a.role)) throw new AuthorizationError();
  return a;
}
export const requireAdmin = (p: Principal | undefined) =>
  requireAnyRole(p, ["admin", "super_admin"]);
export const requireSuperAdmin = (p: Principal | undefined) =>
  requireRole(p, "super_admin");
export async function requireParentOf(
  db: Firestore,
  p: Principal | undefined,
  childId: string,
): Promise<void> {
  const a = requireRole(p, "parent");
  if (!(await db.doc(`parentChildLinks/${a.uid}_${childId}`).get()).exists)
    throw new AuthorizationError();
}
export async function requireMentorOfTeam(
  db: Firestore,
  p: Principal | undefined,
  teamId: string,
): Promise<void> {
  const a = requireRole(p, "mentor");
  if (!(await db.doc(`teamMembers/${teamId}_mentor_${a.uid}`).get()).exists)
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
  await requireMentorOfTeam(db, p, teamId);
}
