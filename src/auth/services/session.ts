import type { Auth, DecodedIdToken, UserRecord } from "firebase-admin/auth";
import { AuthenticationError, InternalError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import type { SessionUser } from "../models/user.js";
import type { MembershipRepository } from "../repositories/memberships.js";
import type { UserRepository } from "../repositories/users.js";
import { normalizeRoles, type Role } from "../roles.js";

export interface SessionContext {
  requestId?: string;
}

export class AuthSessionService {
  constructor(
    private readonly firebaseAuth: Auth,
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
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
      .filter((membership) =>
        ["active", "pending", "suspended"].includes(membership.status),
      )
      .map((membership) => {
        const normalized = normalizeRoles(membership.roles ?? membership.role);
        this.logInvalidRoles(normalized.invalid, decodedToken.uid, context);
        return {
          organizationId: membership.organizationId,
          roles: normalized.roles,
          status: membership.status,
        };
      });

    const storedProfile = profile as unknown as {
      roles?: unknown;
      role?: unknown;
    };
    const global = normalizeRoles(storedProfile.roles ?? storedProfile.role);
    this.logInvalidRoles(global.invalid, decodedToken.uid, context);
    const activeMemberships = memberships.filter(
      (item) => item.status === "active",
    );
    const roles = this.unique([
      ...global.roles,
      ...activeMemberships.flatMap((item) => item.roles),
    ]);
    const disabled = authUser.disabled || profile.status === "disabled";
    const pending = memberships.some((item) => item.status === "pending");

    if (disabled || memberships.some((item) => item.status === "suspended"))
      logger.warn("session_account_restricted", {
        requestId: context.requestId,
        uid: decodedToken.uid,
        disabled,
      });
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

    const session: SessionUser = {
      uid: profile.uid,
      email: profile.email ?? null,
      displayName: profile.displayName,
      roles,
      disabled,
      onboardingStatus: !profile.displayName
        ? "profile_required"
        : roles.length > 0
          ? "complete"
          : pending
            ? "pending_approval"
            : "role_required",
      memberships,
    };
    await this.syncRoleClaims(authUser, decodedToken, roles, context);
    return session;
  }

  private async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    try {
      return await this.firebaseAuth.verifyIdToken(idToken, true);
    } catch {
      throw new AuthenticationError();
    }
  }

  private async getAuthUser(uid: string): Promise<UserRecord> {
    try {
      return await this.firebaseAuth.getUser(uid);
    } catch {
      throw new AuthenticationError();
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

  private unique(roles: Role[]): Role[] {
    return [...new Set(roles)];
  }

  private logInvalidRoles(
    invalid: string[],
    uid: string,
    context: SessionContext,
  ): void {
    for (const value of invalid)
      logger.warn("unknown_stored_role", {
        requestId: context.requestId,
        uid,
        value,
      });
  }

  private async syncRoleClaims(
    authUser: UserRecord,
    decodedToken: DecodedIdToken,
    roles: Role[],
    context: SessionContext,
  ): Promise<void> {
    const currentClaims = authUser.customClaims ?? {};
    const current = normalizeRoles(
      currentClaims.roles ?? decodedToken.roles,
    ).roles;
    if (
      current.length === roles.length &&
      roles.every((role) => current.includes(role))
    )
      return;
    logger.info("session_claim_roles_out_of_sync", {
      requestId: context.requestId,
      uid: authUser.uid,
    });
    try {
      await this.firebaseAuth.setCustomUserClaims(authUser.uid, {
        ...currentClaims,
        roles,
        role: roles[0] ?? null,
      });
    } catch {
      throw new InternalError();
    }
  }
}
