import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  AccountDisabledError,
  OrganizationBootstrapError,
  PersonalWorkspaceBootstrapError,
} from "../shared/errors.js";

export interface PersonalWorkspaceBootstrapInput {
  uid: string;
  requestId: string;
  timezone: string;
}

export interface PersonalWorkspaceBootstrapResult {
  workspace: {
    id: string;
    type: "personal";
    name: string;
    timezone: string;
    status: "active";
  };
  membership: {
    id: string;
    workspaceId: string;
    organizationId: string;
    roles: ["owner"];
    workspaceRoles: ["owner"];
    personas: ["parent"];
    status: "active";
  };
  activeWorkspaceId: string;
  onboardingStatus: "complete";
  nextStep: "dashboard";
  tokenRefreshRequired: true;
}

export interface OrganizationBootstrapInput {
  uid: string;
  requestId: string;
  idempotencyKey?: string;
  name: string;
  slug: string;
  timezone: string;
}

export interface OrganizationBootstrapResult {
  workspace: {
    id: string;
    type: "organization";
    name: string;
    slug: string;
    timezone: string;
    status: "active";
  };
  membership: {
    id: string;
    workspaceId: string;
    organizationId: string;
    roles: string[];
    workspaceRoles: ["owner", "admin"];
    personas: ["admin"];
    status: "active";
  };
  onboardingStatus: "complete";
  nextStep: "dashboard";
  activeWorkspaceId: string;
  tokenRefreshRequired: true;
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const validTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};

type BootstrapUserState = {
  exists: boolean;
  disabled: boolean;
  registrationIntent: unknown;
  onboardingStatus: unknown;
};

export function requirePersonalWorkspaceBootstrapEligibility(
  user: BootstrapUserState,
): void {
  if (user.disabled) throw new AccountDisabledError();
  if (!user.exists || user.registrationIntent !== "personal")
    throw new PersonalWorkspaceBootstrapError(
      "PERSONAL_WORKSPACE_NOT_ELIGIBLE",
    );
  if (user.onboardingStatus === "complete")
    throw new PersonalWorkspaceBootstrapError(
      "PERSONAL_WORKSPACE_BOOTSTRAP_CONFLICT",
    );
  if (user.onboardingStatus !== "personal_workspace_required")
    throw new PersonalWorkspaceBootstrapError(
      "PERSONAL_WORKSPACE_NOT_ELIGIBLE",
    );
}

export function personalWorkspaceName(
  displayName: unknown,
  email: unknown,
): string {
  const display = typeof displayName === "string" ? displayName.trim() : "";
  const address = typeof email === "string" ? email.trim() : "";
  return !display || display.toLocaleLowerCase() === address.toLocaleLowerCase()
    ? "Personal"
    : `Personal — ${display}`;
}

/** Atomic, identity-only bootstrap for a personal registrant's single tenant. */
export class PersonalWorkspaceBootstrapService {
  constructor(private readonly db: Firestore) {}

  async bootstrap(
    input: PersonalWorkspaceBootstrapInput,
  ): Promise<PersonalWorkspaceBootstrapResult> {
    if (!validTimezone(input.timezone))
      throw new PersonalWorkspaceBootstrapError(
        "PERSONAL_WORKSPACE_TIMEZONE_INVALID",
      );
    const workspaceId = `personal-${hash(input.uid).slice(0, 24)}`;
    const membershipId = `${workspaceId}_${input.uid}`;
    const markerRef = this.db.doc(`personalWorkspaceBootstraps/${input.uid}`);
    const workspaceRef = this.db.doc(`workspaces/${workspaceId}`);
    // Personal tenants retain an organization-compatible record for legacy scopes.
    const organizationRef = this.db.doc(`organizations/${workspaceId}`);
    const membershipRef = this.db.doc(`memberships/${membershipId}`);
    const userRef = this.db.doc(`users/${input.uid}`);
    try {
      return await this.db.runTransaction(async (tx) => {
        const [user, marker, workspace, membership] = await Promise.all([
          tx.get(userRef),
          tx.get(markerRef),
          tx.get(workspaceRef),
          tx.get(membershipRef),
        ]);
        if (marker.exists) {
          if (
            marker.get("status") !== "complete" ||
            marker.get("timezone") !== input.timezone ||
            !workspace.exists ||
            !membership.exists ||
            workspace.get("ownerUserId") !== input.uid ||
            membership.get("userId") !== input.uid
          )
            throw new PersonalWorkspaceBootstrapError(
              "PERSONAL_WORKSPACE_BOOTSTRAP_CONFLICT",
            );
          return this.result(
            workspaceId,
            membershipId,
            String(workspace.get("name")),
            input.timezone,
          );
        }
        requirePersonalWorkspaceBootstrapEligibility({
          exists: user.exists,
          disabled:
            user.get("status") === "disabled" || user.get("disabled") === true,
          registrationIntent: user.get("registrationIntent"),
          onboardingStatus: user.get("onboardingStatus"),
        });
        if (workspace.exists || membership.exists)
          throw new PersonalWorkspaceBootstrapError(
            "PERSONAL_WORKSPACE_ALREADY_EXISTS",
          );
        const now = FieldValue.serverTimestamp();
        const name = personalWorkspaceName(
          user.get("displayName"),
          user.get("email"),
        );
        const tenant = {
          type: "personal",
          name,
          ownerUserId: input.uid,
          timezone: input.timezone,
          status: "active",
          version: 1,
          createdAt: now,
          createdBy: input.uid,
          updatedAt: now,
          updatedBy: input.uid,
        };
        tx.create(organizationRef, tenant);
        tx.create(workspaceRef, { ...tenant, organizationId: workspaceId });
        tx.create(membershipRef, {
          userId: input.uid,
          organizationId: workspaceId,
          workspaceId,
          roles: ["owner"],
          workspaceRoles: ["owner"],
          personas: ["parent"],
          status: "active",
          version: 1,
          createdAt: now,
          createdBy: input.uid,
          updatedAt: now,
          updatedBy: input.uid,
        });
        tx.update(userRef, {
          onboardingStatus: "complete",
          activeWorkspaceId: workspaceId,
          personalWorkspaceBootstrapId: markerRef.id,
          updatedAt: now,
          updatedBy: input.uid,
        });
        tx.create(markerRef, {
          uid: input.uid,
          organizationId: workspaceId,
          workspaceId,
          membershipId,
          timezone: input.timezone,
          status: "complete",
          requestId: input.requestId,
          createdAt: now,
        });
        for (const event of [
          "personal_workspace.bootstrap_completed",
          "workspace.created",
          "membership.created",
          "onboarding.completed",
        ])
          tx.create(this.db.collection("auditLogs").doc(), {
            event,
            actorId: input.uid,
            organizationId: workspaceId,
            workspaceId,
            membershipId,
            requestId: input.requestId,
            createdAt: now,
          });
        return this.result(workspaceId, membershipId, name, input.timezone);
      });
    } catch (error) {
      if (
        error instanceof PersonalWorkspaceBootstrapError ||
        error instanceof AccountDisabledError
      )
        throw error;
      throw new PersonalWorkspaceBootstrapError(
        "PERSONAL_WORKSPACE_BOOTSTRAP_FAILED",
      );
    }
  }

  private result(
    workspaceId: string,
    membershipId: string,
    name: string,
    timezone: string,
  ): PersonalWorkspaceBootstrapResult {
    return {
      workspace: {
        id: workspaceId,
        type: "personal",
        name,
        timezone,
        status: "active",
      },
      membership: {
        id: membershipId,
        workspaceId,
        organizationId: workspaceId,
        roles: ["owner"],
        workspaceRoles: ["owner"],
        personas: ["parent"],
        status: "active",
      },
      activeWorkspaceId: workspaceId,
      onboardingStatus: "complete",
      nextStep: "dashboard",
      tokenRefreshRequired: true,
    };
  }
}

/**
 * Dedicated first-workspace policy. In particular, it does not inspect roles,
 * memberships, or an active workspace: those are outputs of this operation.
 */
export function requireOrganizationBootstrapEligibility(
  user: BootstrapUserState,
): void {
  if (user.disabled) throw new AccountDisabledError();
  if (!user.exists || user.registrationIntent !== "organization")
    throw new OrganizationBootstrapError("ORGANIZATION_BOOTSTRAP_NOT_ELIGIBLE");
  if (user.onboardingStatus === "complete")
    throw new OrganizationBootstrapError(
      "ORGANIZATION_BOOTSTRAP_ALREADY_COMPLETED",
    );
  if (user.onboardingStatus !== "organization_setup_required")
    throw new OrganizationBootstrapError("ORGANIZATION_BOOTSTRAP_NOT_ELIGIBLE");
}

/** Dedicated policy and atomic workflow for a registrant's first workspace. */
export class OrganizationBootstrapService {
  constructor(private readonly db: Firestore) {}

  async bootstrap(
    input: OrganizationBootstrapInput,
  ): Promise<OrganizationBootstrapResult> {
    if (!validTimezone(input.timezone))
      throw new OrganizationBootstrapError("ORGANIZATION_TIMEZONE_INVALID");
    const normalizedPayload = JSON.stringify({
      name: input.name,
      slug: input.slug,
      timezone: input.timezone,
    });
    const payloadHash = hash(normalizedPayload);
    const workspaceId = `org-${hash(input.uid).slice(0, 24)}`;
    const membershipId = `${workspaceId}_${input.uid}`;
    const markerRef = this.db.doc(`onboardingBootstraps/${input.uid}`);
    const workspaceRef = this.db.doc(`workspaces/${workspaceId}`);
    const organizationRef = this.db.doc(`organizations/${workspaceId}`);
    const membershipRef = this.db.doc(`memberships/${membershipId}`);
    const userRef = this.db.doc(`users/${input.uid}`);
    const slugRef = this.db.doc(`organizationSlugs/${input.slug}`);

    try {
      return await this.db.runTransaction(async (tx) => {
        const [
          user,
          marker,
          workspace,
          organization,
          membership,
          slug,
          sameName,
        ] = await Promise.all([
          tx.get(userRef),
          tx.get(markerRef),
          tx.get(workspaceRef),
          tx.get(organizationRef),
          tx.get(membershipRef),
          tx.get(slugRef),
          tx.get(
            this.db
              .collection("organizations")
              .where("name", "==", input.name)
              .limit(1),
          ),
        ]);
        if (marker.exists) {
          if (
            marker.get("uid") !== input.uid ||
            marker.get("payloadHash") !== payloadHash ||
            (input.idempotencyKey &&
              marker.get("idempotencyKey") &&
              marker.get("idempotencyKey") !== input.idempotencyKey)
          )
            throw new OrganizationBootstrapError(
              "ORGANIZATION_BOOTSTRAP_CONFLICT",
            );
          if (
            marker.get("workspaceId") !== workspaceId ||
            marker.get("organizationId") !== workspaceId ||
            marker.get("membershipId") !== membershipId ||
            marker.get("status") !== "complete"
          )
            throw new OrganizationBootstrapError(
              "ORGANIZATION_BOOTSTRAP_CONFLICT",
            );
          this.assertRecoverableRecord(workspace, input, input.uid);
          this.assertRecoverableRecord(organization, input, input.uid);
          this.assertRecoverableMembership(membership, input.uid, workspaceId);
          if (slug.exists && slug.get("organizationId") !== workspaceId)
            throw new OrganizationBootstrapError("ORGANIZATION_SLUG_CONFLICT");
          this.repairCommittedBootstrap(tx, {
            input,
            workspaceId,
            membershipId,
            workspace,
            organization,
            membership,
            slug,
            userRef,
            workspaceRef,
            organizationRef,
            membershipRef,
            slugRef,
          });
          return this.result(workspaceId, membershipId, input);
        }

        // Recover a response-lost bootstrap written by an older implementation.
        // The deterministic actor-owned IDs and createdBy/userId evidence are
        // required; a matching slug by itself is never ownership evidence.
        const priorActorState =
          workspace.exists || organization.exists || membership.exists;
        if (priorActorState) {
          this.assertRecoverableRecord(workspace, input, input.uid);
          this.assertRecoverableRecord(organization, input, input.uid);
          this.assertRecoverableMembership(membership, input.uid, workspaceId);
          if (slug.exists && slug.get("organizationId") !== workspaceId)
            throw new OrganizationBootstrapError("ORGANIZATION_SLUG_CONFLICT");
          if (
            user.get("registrationIntent") !== "organization" ||
            (user.get("onboardingStatus") !== "complete" &&
              user.get("onboardingStatus") !== "organization_setup_required")
          )
            throw new OrganizationBootstrapError(
              "ORGANIZATION_BOOTSTRAP_CONFLICT",
            );
          const now = FieldValue.serverTimestamp();
          this.repairCommittedBootstrap(tx, {
            input,
            workspaceId,
            membershipId,
            workspace,
            organization,
            membership,
            slug,
            userRef,
            workspaceRef,
            organizationRef,
            membershipRef,
            slugRef,
          });
          tx.create(markerRef, {
            uid: input.uid,
            organizationId: workspaceId,
            workspaceId,
            membershipId,
            payloadHash,
            idempotencyKey: input.idempotencyKey ?? payloadHash,
            status: "complete",
            requestId: input.requestId,
            recovered: true,
            createdAt: now,
          });
          tx.create(
            this.db.doc(`auditLogs/organization-bootstrap-${input.uid}`),
            {
              event: "organization.bootstrap_recovered",
              actorId: input.uid,
              organizationId: workspaceId,
              workspaceId,
              membershipId,
              requestId: input.requestId,
              createdAt: now,
            },
          );
          return this.result(workspaceId, membershipId, input);
        }
        requireOrganizationBootstrapEligibility({
          exists: user.exists,
          disabled:
            user.get("status") === "disabled" || user.get("disabled") === true,
          registrationIntent: user.get("registrationIntent"),
          onboardingStatus: user.get("onboardingStatus"),
        });
        if (slug.exists)
          throw new OrganizationBootstrapError("ORGANIZATION_SLUG_CONFLICT");
        if (!sameName.empty)
          throw new OrganizationBootstrapError("ORGANIZATION_NAME_CONFLICT");

        const now = FieldValue.serverTimestamp();
        const organizationRecord = {
          type: "organization",
          name: input.name,
          slug: input.slug,
          timezone: input.timezone,
          status: "active",
          version: 1,
          createdAt: now,
          createdBy: input.uid,
          updatedAt: now,
          updatedBy: input.uid,
        };
        tx.create(organizationRef, organizationRecord);
        tx.create(workspaceRef, {
          ...organizationRecord,
          organizationId: workspaceId,
        });
        tx.create(slugRef, {
          slug: input.slug,
          organizationId: workspaceId,
          createdAt: now,
        });
        tx.create(membershipRef, {
          userId: input.uid,
          organizationId: workspaceId,
          workspaceId,
          roles: ["owner", "admin"],
          workspaceRoles: ["owner", "admin"],
          personas: ["admin"],
          status: "active",
          version: 1,
          createdAt: now,
          createdBy: input.uid,
          updatedAt: now,
          updatedBy: input.uid,
        });
        tx.update(userRef, {
          onboardingStatus: "complete",
          activeWorkspaceId: workspaceId,
          organizationBootstrapId: markerRef.id,
          updatedAt: now,
          updatedBy: input.uid,
        });
        tx.create(markerRef, {
          uid: input.uid,
          organizationId: workspaceId,
          workspaceId,
          membershipId,
          payloadHash,
          idempotencyKey: input.idempotencyKey ?? payloadHash,
          status: "complete",
          requestId: input.requestId,
          createdAt: now,
        });
        for (const event of [
          "organization.bootstrap_completed",
          "organization.created",
          "membership.created",
          "onboarding.completed",
        ])
          tx.create(this.db.collection("auditLogs").doc(), {
            event,
            actorId: input.uid,
            organizationId: workspaceId,
            workspaceId,
            membershipId,
            requestId: input.requestId,
            createdAt: now,
          });
        return this.result(workspaceId, membershipId, input);
      });
    } catch (error) {
      if (
        error instanceof OrganizationBootstrapError ||
        error instanceof AccountDisabledError
      )
        throw error;
      throw new OrganizationBootstrapError("ORGANIZATION_BOOTSTRAP_FAILED");
    }
  }

  private assertRecoverableRecord(
    snapshot: FirebaseFirestore.DocumentSnapshot,
    input: OrganizationBootstrapInput,
    uid: string,
  ): void {
    if (!snapshot.exists) return;
    if (
      snapshot.get("createdBy") !== uid ||
      snapshot.get("type") !== "organization" ||
      snapshot.get("name") !== input.name ||
      snapshot.get("slug") !== input.slug ||
      snapshot.get("timezone") !== input.timezone ||
      snapshot.get("status") !== "active"
    )
      throw new OrganizationBootstrapError("ORGANIZATION_BOOTSTRAP_CONFLICT");
  }

  private assertRecoverableMembership(
    snapshot: FirebaseFirestore.DocumentSnapshot,
    uid: string,
    workspaceId: string,
  ): void {
    if (!snapshot.exists) return;
    const roles = snapshot.get("roles");
    if (
      snapshot.get("userId") !== uid ||
      snapshot.get("workspaceId") !== workspaceId ||
      snapshot.get("organizationId") !== workspaceId ||
      snapshot.get("status") !== "active" ||
      !Array.isArray(roles) ||
      !roles.includes("owner") ||
      !roles.includes("admin")
    )
      throw new OrganizationBootstrapError("ORGANIZATION_BOOTSTRAP_CONFLICT");
  }

  private repairCommittedBootstrap(
    tx: FirebaseFirestore.Transaction,
    state: {
      input: OrganizationBootstrapInput;
      workspaceId: string;
      membershipId: string;
      workspace: FirebaseFirestore.DocumentSnapshot;
      organization: FirebaseFirestore.DocumentSnapshot;
      membership: FirebaseFirestore.DocumentSnapshot;
      slug: FirebaseFirestore.DocumentSnapshot;
      userRef: FirebaseFirestore.DocumentReference;
      workspaceRef: FirebaseFirestore.DocumentReference;
      organizationRef: FirebaseFirestore.DocumentReference;
      membershipRef: FirebaseFirestore.DocumentReference;
      slugRef: FirebaseFirestore.DocumentReference;
    },
  ): void {
    const now = FieldValue.serverTimestamp();
    const tenant = {
      type: "organization",
      name: state.input.name,
      slug: state.input.slug,
      timezone: state.input.timezone,
      status: "active",
      version: 1,
      createdAt: now,
      createdBy: state.input.uid,
      updatedAt: now,
      updatedBy: state.input.uid,
    };
    if (!state.organization.exists) tx.create(state.organizationRef, tenant);
    if (!state.workspace.exists)
      tx.create(state.workspaceRef, {
        ...tenant,
        organizationId: state.workspaceId,
      });
    if (!state.membership.exists)
      tx.create(state.membershipRef, {
        userId: state.input.uid,
        organizationId: state.workspaceId,
        workspaceId: state.workspaceId,
        roles: ["owner", "admin"],
        workspaceRoles: ["owner", "admin"],
        personas: ["admin"],
        status: "active",
        version: 1,
        createdAt: now,
        createdBy: state.input.uid,
        updatedAt: now,
        updatedBy: state.input.uid,
      });
    if (!state.slug.exists)
      tx.create(state.slugRef, {
        slug: state.input.slug,
        organizationId: state.workspaceId,
        createdAt: now,
      });
    tx.update(state.userRef, {
      onboardingStatus: "complete",
      activeWorkspaceId: state.workspaceId,
      organizationBootstrapId: state.input.uid,
      updatedAt: now,
      updatedBy: state.input.uid,
    });
  }

  private result(
    workspaceId: string,
    membershipId: string,
    input: OrganizationBootstrapInput,
  ): OrganizationBootstrapResult {
    return {
      workspace: {
        id: workspaceId,
        type: "organization",
        name: input.name,
        slug: input.slug,
        timezone: input.timezone,
        status: "active",
      },
      membership: {
        id: membershipId,
        workspaceId,
        organizationId: workspaceId,
        roles: ["owner", "admin"],
        workspaceRoles: ["owner", "admin"],
        personas: ["admin"],
        status: "active",
      },
      onboardingStatus: "complete",
      nextStep: "dashboard",
      activeWorkspaceId: workspaceId,
      tokenRefreshRequired: true,
    };
  }
}
