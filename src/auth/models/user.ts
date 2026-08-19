import type { Timestamp } from "firebase-admin/firestore";
import type { Role } from "../authorization.js";

export type UserStatus = "active" | "disabled";
export type MembershipStatus = "active" | "pending" | "suspended";
export type OnboardingStatus =
  | "complete"
  | "role_required"
  | "profile_required"
  | "pending_approval";

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
    status: MembershipStatus;
  }>;
}
