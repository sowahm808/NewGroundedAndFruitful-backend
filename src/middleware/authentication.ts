import type { NextFunction, Request, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { auth, db } from "../config/firebase.js";
import {
  AccountDisabledError,
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
import { deriveCapabilities, resolvePersonas } from "../auth/capabilities.js";
import {
  logBearerHeaderFailure,
  verifyBearerToken,
} from "../auth/token-verification.js";
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
    const workspaceRoles = Array.isArray(data.workspaceRoles)
      ? data.workspaceRoles.filter(
          (role): role is string => typeof role === "string",
        )
      : [];
    const personas = resolvePersonas(data.personas, workspaceRoles, roles);
    memberships.push({
      id: doc.id,
      userId: token.uid,
      organizationId: data.organizationId,
      roles,
      ...(typeof data.workspaceId === "string"
        ? { workspaceId: data.workspaceId }
        : {}),
      ...(workspaceRoles.length > 0 ? { workspaceRoles } : {}),
      ...(personas.length > 0 ? { personas } : {}),
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
    if (!header) {
      logBearerHeaderFailure(
        req.requestId,
        "missing_authorization",
        "protected_route",
      );
      return next();
    }
    const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
    if (!match?.[1]) {
      logBearerHeaderFailure(
        req.requestId,
        "malformed_bearer_header",
        "protected_route",
      );
      throw new AuthenticationError("INVALID_AUTHENTICATION_TOKEN");
    }
    const token: DecodedIdToken = await verifyBearerToken(auth, match[1], {
      requestId: req.requestId,
      policy: "protected_route",
    });
    const resolved = await resolvePrincipal(db, token);
    const user = await db.doc(`users/${token.uid}`).get();
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
      (typeof user.get("activeWorkspaceId") === "string" &&
      resolved.memberships.some(
        (membership) =>
          (membership.workspaceId ?? membership.organizationId) ===
          user.get("activeWorkspaceId"),
      )
        ? String(user.get("activeWorkspaceId"))
        : undefined) ||
      (resolved.organizationIds.length === 1
        ? resolved.organizationIds[0]
        : undefined);
    const elevations = await new ElevationService(db).activeForUser(
      token.uid,
      activeWorkspaceId,
    );
    const activeMembership = resolved.memberships.find(
      (membership) =>
        (membership.workspaceId ?? membership.organizationId) ===
        activeWorkspaceId,
    );
    const workspaceRoles = activeMembership?.workspaceRoles ?? [];
    const personas = resolvePersonas(
      activeMembership?.personas,
      workspaceRoles,
      activeMembership?.roles ?? [],
    );
    const derivedCapabilities = deriveCapabilities(
      personas,
      workspaceRoles,
      activeMembership?.roles ?? [],
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
        ...new Set([
          ...derivedCapabilities,
          ...elevations.flatMap((grant) => grant.capabilities),
        ]),
      ],
      personas,
      workspaceRoles,
      ...(activeWorkspaceId ? { activeWorkspaceId } : {}),
      ...(activeMembership
        ? { activeOrganizationId: activeMembership.organizationId }
        : {}),
      ...(typeof user.get("onboardingStatus") === "string"
        ? { onboardingStatus: String(user.get("onboardingStatus")) }
        : {}),
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
    // verifyBearerToken already translates Firebase token failures into a safe
    // AuthenticationError. Do not relabel failures from Firestore-backed
    // principal, membership, or elevation resolution as invalid credentials:
    // the application error boundary must be allowed to map dependency errors
    // to its retryable 503 contract.
    next(error);
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
    if (!header) {
      logBearerHeaderFailure(
        req.requestId,
        "missing_authorization",
        "registration_authentication",
      );
      throw new AuthenticationError();
    }
    const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
    if (!match?.[1]) {
      logBearerHeaderFailure(
        req.requestId,
        "malformed_bearer_header",
        "registration_authentication",
      );
      throw new AuthenticationError("INVALID_AUTHENTICATION_TOKEN");
    }
    const token = await verifyBearerToken(auth, match[1], {
      requestId: req.requestId,
      policy: "registration_authentication",
    });
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
    // Account-policy reads happen after token verification. Preserve provider
    // failures so the application boundary can distinguish an unavailable
    // dependency from an invalid Firebase identity.
    next(error);
  }
}
