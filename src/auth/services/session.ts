import type { Auth, DecodedIdToken, UserRecord } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { AuthenticationError, InternalError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import type { SessionUser } from "../models/user.js";
import type { MembershipRepository } from "../repositories/memberships.js";
import type { UserRepository } from "../repositories/users.js";
import { normalizeRoles, type Role } from "../roles.js";
import { resolveRoles } from "../role-resolution.js";
import { env } from "../../config/env.js";
import {
  authorizedClaims,
  effectiveRoles as aggregateRoles,
  synchronizeClaims,
  trustedPlatformRoles,
  type PlatformRole,
} from "../claims.js";
import { ElevationService } from "../elevations.js";

export interface SessionContext {
  requestId?: string;
  authorizationPresent?: boolean;
}

export class AuthSessionService {
  constructor(
    private readonly firebaseAuth: Auth,
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly enforcementMode:
      | "compatibility"
      | "strict" = env.MEMBERSHIP_ENFORCEMENT_MODE,
  ) {}

  async createSession(
    idToken: string,
    context: SessionContext = {},
  ): Promise<SessionUser> {
    const decodedToken = await this.verifyIdToken(idToken);
    const authUser = await this.getAuthUser(decodedToken.uid);
    const existing = await this.users.getUserByUid(decodedToken.uid);
    if (!existing)
      logger.warn("session_profile_not_found", {
        requestId: context.requestId,
        uid: decodedToken.uid,
      });

    // Idempotently create identity/profile fields only. Authentication does not
    // imply an application role and token claims never seed authorization data.
    const profile = await this.users.provisionUserProfile({
      uid: decodedToken.uid,
      email: authUser.email ?? decodedToken.email ?? null,
      displayName: this.displayName(authUser, decodedToken),
    });
    const storedMemberships = await this.memberships.listForUser(
      decodedToken.uid,
    );
    const memberships = storedMemberships
      .filter((membership) => membership.userId === decodedToken.uid)
      .map((membership) => {
        const normalized = normalizeRoles(membership.roles ?? membership.role);
        this.logInvalidRoles(normalized.invalid, decodedToken.uid, context);
        return {
          organizationId: membership.organizationId,
          ...(membership.workspaceId
            ? { workspaceId: membership.workspaceId }
            : {}),
          ...((membership.workspaceRoles?.length ?? 0) > 0
            ? { workspaceRoles: membership.workspaceRoles }
            : {}),
          roles: normalized.roles,
          status: membershipStatus(membership.status, membership.expiresAt),
        };
      });

    const activeMemberships = memberships.filter(
      (item) => item.status === "active",
    );
    const workspaceIds = [
      ...new Set(
        activeMemberships.map((m) => m.workspaceId ?? m.organizationId),
      ),
    ];
    const sessionDb = (this.users as unknown as { firestore?: Firestore })
      .firestore;
    const workspaceDocuments = sessionDb
      ? await Promise.all(
          workspaceIds.map(async (id) => {
            const workspace = await sessionDb.doc(`workspaces/${id}`).get();
            if (workspace.exists) return workspace;
            return sessionDb.doc(`organizations/${id}`).get();
          }),
        )
      : [];
    const workspaces = workspaceDocuments.flatMap((doc, index) =>
      !doc.exists
        ? []
        : [
            {
              id: workspaceIds[index]!,
              type:
                doc.get("type") === "personal"
                  ? ("personal" as const)
                  : ("organization" as const),
              name: String(doc.get("name") ?? "Workspace"),
              status: String(doc.get("status") ?? "active"),
              roles:
                activeMemberships.find(
                  (m) =>
                    (m.workspaceId ?? m.organizationId) === workspaceIds[index],
                )?.workspaceRoles ??
                activeMemberships.find(
                  (m) =>
                    (m.workspaceId ?? m.organizationId) === workspaceIds[index],
                )?.roles ??
                [],
            },
          ],
    );
    const storedActiveWorkspaceId = profile.activeWorkspaceId;
    const activeWorkspaceId = workspaceIds.includes(
      storedActiveWorkspaceId ?? "",
    )
      ? storedActiveWorkspaceId
      : workspaceIds.length === 1
        ? workspaceIds[0]
        : undefined;
    const storedProfile = profile as unknown as {
      roles?: unknown;
      role?: unknown;
    };
    const resolution = resolveRoles(
      memberships,
      storedProfile.roles ?? storedProfile.role,
      this.enforcementMode,
    );
    this.logInvalidRoles(
      [...resolution.invalidLegacyRoles],
      decodedToken.uid,
      context,
    );
    const platformRoles = trustedPlatformRoles(
      authUser.customClaims ?? {},
      storedProfile.roles ?? storedProfile.role,
    );
    const roles = aggregateRoles(platformRoles, resolution.roles);
    const disabled = authUser.disabled || profile.status === "disabled";
    const pending = memberships.some((item) => item.status === "pending");
    const childOrganizations = activeMemberships
      .filter((item) => item.roles.includes("child"))
      .map((item) => item.organizationId);
    const hasChildContext =
      childOrganizations.length === 0
        ? true
        : await this.memberships.hasActiveChildContext(
            decodedToken.uid,
            childOrganizations,
          );

    // A suspended membership is inactive, not a global account suspension. It
    // disables onboarding only when there is no separate active membership.
    const suspendedOnly =
      activeMemberships.length === 0 &&
      memberships.some((item) => item.status === "suspended");
    const restricted = disabled || suspendedOnly;
    const activeElevations =
      restricted || !sessionDb
        ? []
        : await new ElevationService(sessionDb).activeForUser(
            decodedToken.uid,
            activeWorkspaceId,
          );
    if (restricted) {
      logger.warn("session_account_restricted", {
        requestId: context.requestId,
        uid: decodedToken.uid,
        disabled,
        suspended: suspendedOnly,
      });
    }
    if (activeMemberships.length === 0)
      logger.warn("session_no_active_membership", {
        requestId: context.requestId,
        uid: decodedToken.uid,
      });
    if (roles.length === 0)
      logger.warn("session_empty_role_resolution", {
        requestId: context.requestId,
        uid: decodedToken.uid,
      });

    const effectiveRoles = restricted ? [] : roles;
    const claimSynchronization = await this.syncRoleClaims(
      authUser,
      effectiveRoles,
      platformRoles,
      storedProfile.roles ?? storedProfile.role,
      context,
    );
    const session: SessionUser = {
      uid: profile.uid,
      email: profile.email ?? null,
      displayName: profile.displayName,
      roles: effectiveRoles,
      platformRoles: restricted ? [] : platformRoles,
      disabled: restricted,
      onboardingStatus: restricted
        ? "disabled"
        : profile.onboardingStatus === "personal_setup" ||
            profile.onboardingStatus === "organization_setup" ||
            profile.onboardingStatus === "personal_workspace_required" ||
            profile.onboardingStatus === "organization_setup_required" ||
            profile.onboardingStatus === "registration_intent_required"
          ? profile.onboardingStatus
          : roles.includes("child") && !hasChildContext
            ? "pending"
            : platformRoles.includes("super_admin")
              ? "complete"
              : roles.length > 0 && activeMemberships.length > 0
                ? "complete"
                : resolution.source === "legacy_user_profile" &&
                    resolution.migrationRequired
                  ? "organization_required"
                  : pending
                    ? "pending"
                    : "role_required",
      ...(profile.registrationIntent
        ? {
            registrationIntent: profile.registrationIntent,
            nextStep:
              profile.registrationIntent === "organization"
                ? ("organization_setup" as const)
                : ("personal_workspace_setup" as const),
          }
        : {}),
      claimSynchronization,
      tokenRefreshRequired: claimSynchronization.tokenRefreshRequired,
      memberships,
      workspaces,
      baseRoles: effectiveRoles,
      effectiveRoles: [
        ...new Set([
          ...effectiveRoles,
          ...activeElevations.flatMap((grant) => grant.roles),
        ]),
      ],
      activeElevations,
      ...(activeWorkspaceId ? { activeWorkspaceId } : {}),
      authorization: {
        source:
          platformRoles.length > 0
            ? "platform_claims_and_memberships"
            : resolution.source,
        migrationRequired: resolution.migrationRequired,
      },
      ...(new Set(activeMemberships.map((item) => item.organizationId)).size ===
      1
        ? { activeOrganizationId: activeMemberships[0]!.organizationId }
        : {}),
    };
    logger.info("session_resolved", {
      requestId: context.requestId,
      uid: decodedToken.uid,
      authorizationPresent: context.authorizationPresent ?? true,
      profileFound: Boolean(existing),
      membershipCount: memberships.length,
      activeMembershipCount: activeMemberships.length,
      roleCount: roles.length,
      authorizationSource: resolution.source,
      migrationRequired: resolution.migrationRequired,
      onboardingStatus: session.onboardingStatus,
      disabled,
    });
    return session;
  }

  private async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    try {
      return await this.firebaseAuth.verifyIdToken(idToken, true);
    } catch (error) {
      const code = firebaseErrorCode(error);
      const category = tokenFailureCategory(code);
      logger.warn("session_token_verification_failed", { category });
      throw new AuthenticationError(category);
    }
  }

  private async getAuthUser(uid: string): Promise<UserRecord> {
    try {
      return await this.firebaseAuth.getUser(uid);
    } catch (error) {
      if (firebaseErrorCode(error) === "auth/user-not-found")
        throw new AuthenticationError("INVALID_AUTHENTICATION_TOKEN");
      throw new InternalError();
    }
  }

  private displayName(authUser: UserRecord, token: DecodedIdToken): string {
    return (
      authUser.displayName ??
      (typeof token.name === "string" ? token.name : undefined) ??
      authUser.email ??
      ""
    );
  }

  private logInvalidRoles(
    invalid: string[],
    uid: string,
    context: SessionContext,
  ): void {
    if (invalid.length > 0)
      logger.warn("invalid_stored_roles", {
        requestId: context.requestId,
        uid,
        invalidCount: invalid.length,
      });
  }

  private async syncRoleClaims(
    authUser: UserRecord,
    roles: Role[],
    platformRoles: PlatformRole[],
    profileRoles: unknown,
    context: SessionContext,
  ): Promise<SessionUser["claimSynchronization"]> {
    try {
      const result = await synchronizeClaims(
        this.firebaseAuth,
        authUser.uid,
        (fresh) => {
          const freshPlatformRoles = trustedPlatformRoles(
            fresh.customClaims ?? {},
            profileRoles,
          );
          // Explicit revocation wins: never resurrect a role from the stale token.
          const authorizedPlatformRoles = platformRoles.filter((role) =>
            freshPlatformRoles.includes(role),
          );
          return authorizedClaims(
            fresh.customClaims ?? {},
            authorizedPlatformRoles,
            aggregateRoles(
              authorizedPlatformRoles,
              roles.filter((role) => role !== "super_admin"),
            ),
          );
        },
      );
      if (!result.changed)
        return { status: "synchronized", tokenRefreshRequired: false };
      logger.info("session_claim_roles_synchronized", {
        requestId: context.requestId,
        uid: authUser.uid,
        beforeRoles: normalizeRoles(result.before.roles).roles,
        afterRoles: normalizeRoles(result.after.roles).roles,
      });
      return { status: "refresh_required", tokenRefreshRequired: true };
    } catch {
      // Authoritative session authorization must remain available if the
      // claims cache is temporarily unavailable. Do not expose provider data.
      logger.warn("session_claim_sync_failed", {
        requestId: context.requestId,
        uid: authUser.uid,
      });
      return { status: "retry_required", tokenRefreshRequired: false };
    }
  }
}

function isExpired(value: unknown): boolean {
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
  // An unreadable expiry on an otherwise active membership fails closed.
  return true;
}

function membershipStatus(
  status: string,
  expiresAt: unknown,
): "active" | "pending" | "suspended" | "revoked" | "expired" | "invalid" {
  if (!["active", "pending", "suspended", "revoked"].includes(status))
    return "invalid";
  if (status === "active" && isExpired(expiresAt)) return "expired";
  return status as "active" | "pending" | "suspended" | "revoked";
}

function firebaseErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error))
    return "unknown";
  return typeof error.code === "string" ? error.code : "unknown";
}

function tokenFailureCategory(
  code: string,
):
  | "INVALID_AUTHENTICATION_TOKEN"
  | "EXPIRED_AUTHENTICATION_TOKEN"
  | "REVOKED_AUTHENTICATION_TOKEN" {
  if (code === "auth/id-token-expired") return "EXPIRED_AUTHENTICATION_TOKEN";
  if (code === "auth/id-token-revoked") return "REVOKED_AUTHENTICATION_TOKEN";
  return "INVALID_AUTHENTICATION_TOKEN";
}
