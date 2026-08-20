import type { Timestamp } from "firebase-admin/firestore";
import type { Role } from "../authorization.js";

export type UserStatus = "active" | "disabled";
export type MembershipStatus = "active" | "pending" | "suspended" | "revoked";
export type OnboardingStatus =
  | "complete"
  | "organization_required"
  | "role_required"
  | "pending"
  | "disabled"
  | "session_error";

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string;
  roles: Role[];
  status: UserStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string;
  roles: readonly Role[];
  disabled: boolean;
  onboardingStatus: OnboardingStatus;
  claimSynchronization: {
    status: "synchronized" | "refresh_required" | "retry_required";
    tokenRefreshRequired: boolean;
  };
  memberships: Array<{
    organizationId: string;
    roles: readonly Role[];
    status: MembershipStatus | "expired" | "invalid";
  }>;
  /** Resolved only when exactly one active organization is available. */
  activeOrganizationId?: string;
  authorization: {
    source: "membership" | "legacy_user_profile" | "none";
    migrationRequired: boolean;
  };
}
