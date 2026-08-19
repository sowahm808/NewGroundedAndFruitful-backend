import type { NextFunction, Request, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { auth, db } from "../config/firebase.js";
import { AuthenticationError, AuthorizationError } from "../shared/errors.js";
import { type Role } from "../auth/authorization.js";
import { normalizeRoles } from "../auth/roles.js";
export { isRole } from "../auth/roles.js";

export async function resolvePrincipal(
  firestore: Firestore,
  token: DecodedIdToken,
): Promise<{ roles: Role[]; organizationIds: string[] }> {
  const user = await firestore.doc(`users/${token.uid}`).get();
  if (!user.exists || user.get("status") === "disabled")
    throw new AuthorizationError();
  const global = normalizeRoles(user.get("roles") ?? user.get("role")).roles;
  const membershipSnapshot = await firestore
    .collection("memberships")
    .where("userId", "==", token.uid)
    .get();
  const membershipRoles: Role[] = [];
  const organizationIds: string[] = [];
  for (const doc of membershipSnapshot.docs) {
    const data = doc.data();
    if (data.userId !== token.uid) continue;
    if (data.status === "suspended" || data.status === "deleted")
      throw new AuthorizationError();
    if (data.status !== "active") continue;
    membershipRoles.push(...normalizeRoles(data.roles ?? data.role).roles);
    if (typeof data.organizationId === "string")
      organizationIds.push(data.organizationId);
  }
  const roles = [...new Set([...global, ...membershipRoles])];
  if (roles.length === 0) throw new AuthorizationError();
  return { roles, organizationIds: [...new Set(organizationIds)] };
}

/** @deprecated Use resolvePrincipal when enforcing organization boundaries. */
export async function resolvePrincipalRole(
  firestore: Firestore,
  token: DecodedIdToken,
): Promise<Role> {
  return (await resolvePrincipal(firestore, token)).roles[0]!;
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const header = req.header("authorization");
    if (!header) return next();
    const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
    if (!match?.[1])
      throw new AuthenticationError("INVALID_AUTHENTICATION_TOKEN");
    const token: DecodedIdToken = await auth.verifyIdToken(match[1], true);
    const resolved = await resolvePrincipal(db, token);
    req.principal = {
      uid: token.uid,
      role: resolved.roles[0]!,
      roles: resolved.roles,
      organizationIds: resolved.organizationIds,
      token,
    };
    next();
  } catch (error) {
    next(
      error instanceof AuthorizationError
        ? error
        : new AuthenticationError("INVALID_AUTHENTICATION_TOKEN"),
    );
  }
}
