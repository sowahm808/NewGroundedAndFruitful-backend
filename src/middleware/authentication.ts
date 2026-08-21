import type { NextFunction, Request, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { auth, db } from "../config/firebase.js";
import {
  AccountDisabledError,
  AppError,
  AuthenticationError,
  AuthorizationError,
} from "../shared/errors.js";
import { type Role } from "../auth/authorization.js";
import { normalizeRoles } from "../auth/roles.js";
import type { ActiveMembership } from "../auth/policy.js";
import {
  resolveRoles,
  type AuthorizationSource,
} from "../auth/role-resolution.js";
import { env } from "../config/env.js";
import { trustedPlatformRoles } from "../auth/claims.js";
import { ElevationService } from "../auth/elevations.js";
import { logger } from "../shared/logger.js";
export { isRole } from "../auth/roles.js";

export async function resolvePrincipal(
  firestore: Firestore,
  token: DecodedIdToken,
  mode: "compatibility" | "strict" = env.MEMBERSHIP_ENFORCEMENT_MODE,
  allowRoleless = false,
): Promise<{
  roles: Role[];
  platformRoles: Array<"super_admin">;
  organizationIds: string[];
  memberships: ActiveMembership[];
  authorizationSource: AuthorizationSource;
}> {
  const user = await firestore.doc(`users/${token.uid}`).get();
  if (user.exists && user.get("status") === "disabled")
    throw new AccountDisabledError();
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
  const roles = [...resolution.roles];
  const platformRoles = trustedPlatformRoles(
    token,
    user.exists ? (user.get("roles") ?? user.get("role")) : undefined,
  );
  roles.push(...platformRoles);
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
  if (roles.length === 0 && !allowRoleless) throw new AuthorizationError();
  return {
    roles,
    platformRoles,
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
    const requestedWorkspaceId = req.header("x-workspace-id")?.trim();
    if (
      requestedWorkspaceId &&
      !resolved.memberships.some(
        (membership) =>
          membership.organizationId === requestedWorkspaceId &&
          membership.userId === token.uid,
      )
    )
      throw new AuthorizationError();
    const activeWorkspaceId =
      requestedWorkspaceId ||
      (resolved.organizationIds.length === 1
        ? resolved.organizationIds[0]
        : undefined);
    const elevations = await new ElevationService(db).activeForUser(
      token.uid,
      activeWorkspaceId,
    );
    req.principal = {
      uid: token.uid,
      role: resolved.roles[0]!,
      roles: resolved.roles,
      baseRoles: resolved.roles,
      effectiveRoles: [
        ...new Set([
          ...resolved.roles,
          ...elevations.flatMap((grant) => grant.roles),
        ]),
      ],
      capabilities: [
        ...new Set(elevations.flatMap((grant) => grant.capabilities)),
      ],
      ...(activeWorkspaceId ? { activeWorkspaceId } : {}),
      platformRoles: resolved.platformRoles,
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
      error instanceof AppError
        ? error
        : new AuthenticationError("INVALID_AUTHENTICATION_TOKEN"),
    );
  }
}

/** Registration authentication deliberately does not resolve roles or tenancy. */
export async function requireFirebaseAuthentication(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const header = req.header("authorization");
    if (!header) throw new AuthenticationError();
    const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
    if (!match?.[1])
      throw new AuthenticationError("INVALID_AUTHENTICATION_TOKEN");
    const token = await auth.verifyIdToken(match[1], true);
    req.principal = {
      uid: token.uid,
      role: undefined as never,
      roles: [],
      baseRoles: [],
      effectiveRoles: [],
      capabilities: [],
      platformRoles: [],
      organizationIds: [],
      memberships: [],
      token,
    };
    logger.info("registration_intent_policy_passed", {
      requestId: req.requestId,
      actorId: token.uid,
      policy: "requireFirebaseAuthentication",
    });
    next();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "auth/user-disabled"
    ) {
      const denial = new AccountDisabledError();
      logger.warn("registration_intent_policy_denied", {
        requestId: req.requestId,
        policy: "requireFirebaseAuthentication",
        denialCode: denial.code,
      });
      return next(denial);
    }
    const denial =
      error instanceof AuthenticationError
        ? error
        : new AuthenticationError("INVALID_AUTHENTICATION_TOKEN");
    logger.warn("registration_intent_policy_denied", {
      requestId: req.requestId,
      policy: "requireFirebaseAuthentication",
      denialCode: denial.code,
    });
    next(denial);
  }
}

/** Registration account policy observes memberships but never requires one. */
export async function requireEnabledRegistrationAccount(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const uid = req.principal?.uid;
  if (!uid) return next(new AuthenticationError());
  try {
    const [firebaseUser, profile, memberships] = await Promise.all([
      auth.getUser(uid),
      db.doc(`users/${uid}`).get(),
      db.collection("memberships").where("userId", "==", uid).limit(1).get(),
    ]);
    const context = {
      requestId: req.requestId,
      actorId: uid,
      policy: "requireEnabledAccount",
      onboardingStatus: profile.exists
        ? String(
            profile.get("onboardingStatus") ?? "registration_intent_required",
          )
        : "registration_intent_required",
      hasMemberships: !memberships.empty,
    };
    if (firebaseUser.disabled || profile.get("status") === "disabled") {
      const denial = new AccountDisabledError();
      logger.warn("registration_intent_policy_denied", {
        ...context,
        denialCode: denial.code,
      });
      return next(denial);
    }
    logger.info("registration_intent_policy_passed", context);
    next();
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AuthenticationError("INVALID_AUTHENTICATION_TOKEN"),
    );
  }
}
