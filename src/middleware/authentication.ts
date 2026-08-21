import type { NextFunction, Request, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { auth, db } from "../config/firebase.js";
import { AuthenticationError, AuthorizationError } from "../shared/errors.js";
import { type Role } from "../auth/authorization.js";
import { normalizeRoles } from "../auth/roles.js";
import type { ActiveMembership } from "../auth/policy.js";
import {
  resolveRoles,
  type AuthorizationSource,
} from "../auth/role-resolution.js";
import { env } from "../config/env.js";
export { isRole } from "../auth/roles.js";

export async function resolvePrincipal(
  firestore: Firestore,
  token: DecodedIdToken,
  mode: "compatibility" | "strict" = env.MEMBERSHIP_ENFORCEMENT_MODE,
): Promise<{
  roles: Role[];
  organizationIds: string[];
  memberships: ActiveMembership[];
  authorizationSource: AuthorizationSource;
}> {
  const user = await firestore.doc(`users/${token.uid}`).get();
  if (user.exists && user.get("status") === "disabled")
    throw new AuthorizationError();
  const membershipSnapshot = await firestore
    .collection("memberships")
    .where("userId", "==", token.uid)
    .get();
  const organizationIds: string[] = [];
  const memberships: ActiveMembership[] = [];
  const allMemberships: Array<{
    status: string;
    roles: Role[];
    organizationId?: string;
  }> = [];
  for (const doc of membershipSnapshot.docs) {
    const data = doc.data();
    if (data.userId !== token.uid) continue;
    const normalizedRoles = normalizeRoles(data.roles ?? data.role).roles;
    const status =
      data.status === "active" && membershipExpired(data.expiresAt)
        ? "expired"
        : typeof data.status === "string"
          ? data.status
          : "invalid";
    allMemberships.push({
      status,
      roles: normalizedRoles,
      organizationId: data.organizationId,
    });
    if (status !== "active") continue;
    const roles = normalizedRoles;
    if (
      typeof data.organizationId !== "string" ||
      !Number.isInteger(data.version)
    )
      continue;
    memberships.push({
      id: doc.id,
      userId: token.uid,
      organizationId: data.organizationId,
      roles,
      status: "active",
      version: data.version,
      ...(Array.isArray(data.programIds)
        ? {
            programIds: data.programIds.filter(
              (id): id is string => typeof id === "string",
            ),
          }
        : {}),
    });
    if (typeof data.organizationId === "string")
      organizationIds.push(data.organizationId);
  }
  const resolution = resolveRoles(
    allMemberships,
    user.exists ? (user.get("roles") ?? user.get("role")) : undefined,
    mode,
  );
  const tokenRoles = normalizeRoles(token.roles).roles;
  const roles = [...resolution.roles];
  // The platform role is the sole global claim. Tenant roles in claims never
  // create scope; this role must be provisioned through the operator workflow.
  if (tokenRoles.includes("platform_super_admin"))
    roles.push("platform_super_admin");
  if (resolution.source === "legacy_user_profile" && user.exists) {
    const explicitIds = user.get("organizationIds");
    if (Array.isArray(explicitIds))
      organizationIds.push(
        ...explicitIds.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      );
    const explicitId = user.get("organizationId");
    if (typeof explicitId === "string" && explicitId.length > 0)
      organizationIds.push(explicitId);
  }
  // A profile is optional identity metadata and can be provisioned by the
  // session endpoint after sign-in. Do not reject a valid Firebase identity
  // whose active, server-owned membership already grants application access.
  if (roles.length === 0) throw new AuthorizationError();
  return {
    roles,
    organizationIds: [...new Set(organizationIds)],
    memberships,
    authorizationSource: resolution.source,
  };
}

function membershipExpired(value: unknown): boolean {
  if (value == null) return false;
  if (value instanceof Date) return value.getTime() <= Date.now();
  if (
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    const timestamp = value as { toMillis(): number };
    return timestamp.toMillis() <= Date.now();
  }
  return true;
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
      memberships: resolved.memberships,
      ...(resolved.authorizationSource !== "none"
        ? { authorizationSource: resolved.authorizationSource }
        : {}),
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
