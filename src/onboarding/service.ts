import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  AccountDisabledError,
  OrganizationBootstrapError,
} from "../shared/errors.js";

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
        const [user, marker, workspace, membership, slug, sameName] =
          await Promise.all([
            tx.get(userRef),
            tx.get(markerRef),
            tx.get(workspaceRef),
            tx.get(membershipRef),
            tx.get(slugRef),
            tx.get(
              this.db
                .collection("organizations")
                .where("name", "==", input.name)
                .limit(1),
            ),
          ]);
        if (!user.exists || user.get("registrationIntent") !== "organization")
          throw new OrganizationBootstrapError(
            "ORGANIZATION_BOOTSTRAP_NOT_ELIGIBLE",
          );
        if (user.get("status") === "disabled") throw new AccountDisabledError();
        if (marker.exists) {
          if (
            marker.get("payloadHash") !== payloadHash ||
            (input.idempotencyKey &&
              marker.get("idempotencyKey") &&
              marker.get("idempotencyKey") !== input.idempotencyKey)
          )
            throw new OrganizationBootstrapError(
              "ORGANIZATION_BOOTSTRAP_CONFLICT",
            );
          if (!workspace.exists || !membership.exists)
            throw new OrganizationBootstrapError(
              "ORGANIZATION_BOOTSTRAP_FAILED",
            );
          return this.result(workspaceId, membershipId, input);
        }
        if (user.get("onboardingStatus") === "complete")
          throw new OrganizationBootstrapError(
            "ORGANIZATION_BOOTSTRAP_ALREADY_COMPLETED",
          );
        if (user.get("onboardingStatus") !== "organization_setup_required")
          throw new OrganizationBootstrapError(
            "ORGANIZATION_BOOTSTRAP_NOT_ELIGIBLE",
          );
        if (workspace.exists || membership.exists)
          throw new OrganizationBootstrapError(
            "ORGANIZATION_BOOTSTRAP_CONFLICT",
          );
        if (slug.exists)
          throw new OrganizationBootstrapError("ORGANIZATION_SLUG_CONFLICT");
        if (!sameName.empty)
          throw new OrganizationBootstrapError("ORGANIZATION_NAME_CONFLICT");

        const now = FieldValue.serverTimestamp();
        const organization = {
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
        tx.create(organizationRef, organization);
        tx.create(workspaceRef, {
          ...organization,
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
        status: "active",
      },
      onboardingStatus: "complete",
      nextStep: "dashboard",
      activeWorkspaceId: workspaceId,
      tokenRefreshRequired: true,
    };
  }
}
