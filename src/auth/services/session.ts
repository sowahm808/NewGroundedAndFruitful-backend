import type { Auth, DecodedIdToken, UserRecord } from "firebase-admin/auth";
import {
  AuthenticationError,
  AuthorizationError,
  InternalError,
  NotFoundError,
} from "../../shared/errors.js";
import { isRole } from "../../middleware/authentication.js";
import type { Role } from "../authorization.js";
import type { SessionUser, UserProfile } from "../models/user.js";
import type { UserRepository } from "../repositories/users.js";

const defaultSelfRegistrationRoles: Role[] = ["parent"];

export class AuthSessionService {
  constructor(
    private readonly firebaseAuth: Auth,
    private readonly users: UserRepository,
  ) {}

  async createSession(idToken: string): Promise<SessionUser> {
    const decodedToken = await this.verifyIdToken(idToken);
    const authUser = await this.getAuthUser(decodedToken.uid);
    if (authUser.disabled) throw new AuthorizationError();

    const profile = await this.users.provisionUserProfile({
      uid: decodedToken.uid,
      email: authUser.email ?? decodedToken.email ?? null,
      displayName: this.displayName(authUser, decodedToken),
      roles: this.safeDefaultRoles(decodedToken),
    });

    const session = this.toSessionUser(profile);
    if (session.disabled) throw new AuthorizationError();
    await this.syncRoleClaims(authUser, decodedToken, session.roles);
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
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "auth/user-not-found"
      )
        throw new NotFoundError("Firebase user not found.");
      throw new InternalError();
    }
  }

  private displayName(authUser: UserRecord, decodedToken: DecodedIdToken) {
    return (
      authUser.displayName ??
      (typeof decodedToken.name === "string" ? decodedToken.name : undefined) ??
      authUser.email ??
      ""
    );
  }

  private safeDefaultRoles(decodedToken: DecodedIdToken): Role[] {
    const claimRoles = normalizeRoles(decodedToken.roles);
    const claimRole = isRole(decodedToken.role) ? [decodedToken.role] : [];
    const safe = [...claimRoles, ...claimRole].filter(
      (role) => role !== "admin" && role !== "super_admin",
    );
    return safe.length > 0 ? safe : defaultSelfRegistrationRoles;
  }

  private toSessionUser(profile: UserProfile): SessionUser {
    const roles = normalizeRoles(profile.roles);
    return {
      uid: profile.uid,
      email: profile.email ?? null,
      displayName: profile.displayName,
      roles: roles.length > 0 ? roles : defaultSelfRegistrationRoles,
      disabled: profile.status === "disabled",
    };
  }

  private async syncRoleClaims(
    authUser: UserRecord,
    decodedToken: DecodedIdToken,
    roles: Role[],
  ): Promise<void> {
    const currentClaims = authUser.customClaims ?? {};
    const current = normalizeRoles(currentClaims.roles ?? decodedToken.roles);
    const hasSameRoles =
      current.length === roles.length &&
      roles.every((role) => current.includes(role));
    const currentRole = isRole(currentClaims.role ?? decodedToken.role)
      ? (currentClaims.role ?? decodedToken.role)
      : undefined;
    if (hasSameRoles && currentRole === roles[0]) return;
    await this.firebaseAuth
      .setCustomUserClaims(authUser.uid, {
        ...currentClaims,
        roles,
        role: roles[0],
      })
      .catch(() => {
        throw new InternalError();
      });
  }
}

export function normalizeRoles(value: unknown): Role[] {
  if (Array.isArray(value)) return value.filter(isRole);
  if (isRole(value)) return [value];
  return [];
}
