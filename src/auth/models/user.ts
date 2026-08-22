import type { Timestamp } from "firebase-admin/firestore";
import type { Role } from "../authorization.js";
import type { PlatformRole } from "../claims.js";
import type { ProductPersona } from "../capabilities.js";

export type UserStatus = "active" | "disabled";
export type MembershipStatus = "active" | "pending" | "suspended" | "revoked";
export type OnboardingStatus =
  | "personal_setup"
  | "organization_setup"
  | "personal_workspace_required"
  | "organization_setup_required"
  | "registration_intent_required"
  | "invitation_required"
  | "account_recovery_required"
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
  activeWorkspaceId?: string;
  onboardingStatus?:
    | "personal_setup"
    | "organization_setup"
    | "personal_workspace_required"
    | "organization_setup_required"
    | "registration_intent_required"
    | "complete";
  registrationIntent?: "personal" | "organization";
}

export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string;
  roles: readonly Role[];
  platformRoles: readonly PlatformRole[];
  disabled: boolean;
  onboardingStatus: OnboardingStatus;
  registrationIntent?: "personal" | "organization";
  nextStep:
    | "choose_account_type"
    | "personal_workspace_setup"
    | "organization_setup"
    | "accept_invitation"
    | "await_role_assignment"
    | "account_recovery"
    | "dashboard";
  accountStateReason?:
    | "registration_intent_missing"
    | "organization_role_not_assigned"
    | "legacy_account_unclassified"
    | "account_disabled";
  pendingInvitation?: boolean;
  recoveryReference?: string;
  claimSynchronization: {
    status: "synchronized" | "refresh_required" | "retry_required";
    tokenRefreshRequired: boolean;
  };
  tokenRefreshRequired: boolean;
  memberships: Array<{
    organizationId: string;
    workspaceId?: string;
    workspaceRoles?: readonly string[];
    personas?: readonly ProductPersona[];
    roles: readonly Role[];
    status: MembershipStatus | "expired" | "invalid";
  }>;
  /** Resolved only when exactly one active organization is available. */
  activeOrganizationId?: string;
  activeWorkspaceId?: string;
  activeWorkspace?: {
    id: string;
    type: "personal" | "organization";
    name: string;
    status: string;
  };
  workspaceRoles?: readonly string[];
  personas?: readonly ProductPersona[];
  capabilities?: readonly string[];
  workspaces?: Array<{
    id: string;
    type: "personal" | "organization";
    name: string;
    roles: readonly string[];
    status: string;
  }>;
  baseRoles?: readonly Role[];
  effectiveRoles?: readonly string[];
  activeElevations?: Array<{
    id: string;
    roles: string[];
    capabilities: string[];
    scope: unknown;
    expiresAt: Date;
  }>;
  authorization: {
    source:
      | "platform_claims_and_memberships"
      | "membership"
      | "legacy_user_profile"
      | "none";
    migrationRequired: boolean;
  };
}
