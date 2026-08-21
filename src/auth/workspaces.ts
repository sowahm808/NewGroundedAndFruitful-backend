import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import {
  AccountDisabledError,
  AuthorizationError,
  ConflictError,
  ValidationError,
  RegistrationIntentConflictError,
} from "../shared/errors.js";

export const registrationIntentSchema = z.discriminatedUnion("intent", [
  z
    .object({
      intent: z.literal("personal"),
      timezone: z.string().min(1).max(80).default("UTC"),
    })
    .strict(),
  z.object({ intent: z.literal("organization") }).strict(),
]);
export const workspaceSelectionSchema = z
  .object({ workspaceId: z.string().min(1).max(128) })
  .strict();
export type WorkspaceType = "personal" | "organization";
export type RegistrationIntent = WorkspaceType;

export class RegistrationIntentService {
  constructor(private readonly db: Firestore) {}

  async select(
    uid: string,
    identity: { email: string | null; displayName: string },
    intent: RegistrationIntent,
    requestId: string,
  ) {
    const userRef = this.db.doc(`users/${uid}`);
    return this.db.runTransaction(async (tx) => {
      const [profile, memberships] = await Promise.all([
        tx.get(userRef),
        tx.get(this.db.collection("memberships").where("userId", "==", uid)),
      ]);
      if (profile.exists && profile.get("status") === "disabled")
        throw new AccountDisabledError();
      const previousIntent = profile.get("registrationIntent") as
        | RegistrationIntent
        | undefined;
      const previousStatus = String(
        profile.get("onboardingStatus") ?? "new_authenticated_user",
      );
      const bootstrapped =
        !memberships.empty ||
        typeof profile.get("personalWorkspaceId") === "string" ||
        previousStatus === "complete";
      if (bootstrapped && previousIntent !== intent)
        throw new RegistrationIntentConflictError(
          previousStatus === "complete"
            ? "REGISTRATION_ALREADY_COMPLETED"
            : "REGISTRATION_INTENT_CONFLICT",
        );

      const onboardingStatus =
        intent === "organization"
          ? ("organization_setup_required" as const)
          : ("personal_workspace_required" as const);
      const nextStep =
        intent === "organization"
          ? ("organization_setup" as const)
          : ("personal_workspace_setup" as const);
      if (bootstrapped && previousStatus === "complete")
        throw new RegistrationIntentConflictError(
          "REGISTRATION_ALREADY_COMPLETED",
        );
      if (bootstrapped && previousStatus !== onboardingStatus)
        throw new RegistrationIntentConflictError();
      if (previousIntent === intent && previousStatus === onboardingStatus)
        return {
          registrationIntent: intent,
          onboardingStatus,
          nextStep,
          version: Number(profile.get("version") ?? 1),
        };

      const now = FieldValue.serverTimestamp();
      const version = Number(profile.get("version") ?? 0) + 1;
      tx.set(
        userRef,
        {
          uid,
          email: identity.email,
          displayName: identity.displayName,
          roles: profile.exists ? (profile.get("roles") ?? []) : [],
          status: profile.exists
            ? (profile.get("status") ?? "active")
            : "active",
          registrationIntent: intent,
          onboardingStatus,
          intentSelectedAt: now,
          updatedAt: now,
          version,
          ...(!profile.exists ? { createdAt: now } : {}),
        },
        { merge: true },
      );
      tx.create(this.db.collection("auditLogs").doc(), {
        event: "registration.intent_selected",
        actorUid: uid,
        intent,
        previousOnboardingState: previousStatus,
        resultingOnboardingState: onboardingStatus,
        requestId,
        createdAt: now,
      });
      return {
        registrationIntent: intent,
        onboardingStatus,
        nextStep,
        version,
      };
    });
  }
}

const personalId = (uid: string) =>
  `personal-${createHash("sha256").update(uid).digest("hex").slice(0, 24)}`;

/** Additive workspace layer: organizationId remains the tenant key during migration. */
export class WorkspaceService {
  constructor(private readonly db: Firestore) {}

  async register(
    uid: string,
    displayName: string,
    input: z.infer<typeof registrationIntentSchema>,
  ) {
    if (input.intent === "organization") {
      await this.db.doc(`users/${uid}`).set(
        {
          registrationIntent: "organization",
          onboardingStatus: "organization_setup",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return {
        intent: input.intent,
        onboardingStatus: "organization_setup" as const,
      };
    }
    const workspaceId = personalId(uid);
    const workspaceRef = this.db.doc(`workspaces/${workspaceId}`);
    const membershipRef = this.db.doc(`memberships/${workspaceId}_${uid}`);
    await this.db.runTransaction(async (tx) => {
      const [workspace, membership] = await Promise.all([
        tx.get(workspaceRef),
        tx.get(membershipRef),
      ]);
      if (workspace.exists && workspace.get("ownerUserId") !== uid)
        throw new ConflictError();
      const now = FieldValue.serverTimestamp();
      if (!workspace.exists)
        tx.create(workspaceRef, {
          type: "personal",
          name: `Personal — ${displayName || "My workspace"}`,
          ownerUserId: uid,
          status: "active",
          timezone: input.timezone,
          createdAt: now,
          updatedAt: now,
        });
      if (!membership.exists)
        tx.create(membershipRef, {
          userId: uid,
          workspaceId,
          organizationId: workspaceId,
          roles: ["owner"],
          workspaceRoles: ["owner"],
          personas: ["parent"],
          status: "active",
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      tx.set(
        this.db.doc(`users/${uid}`),
        {
          registrationIntent: "personal",
          onboardingStatus: "personal_setup",
          personalWorkspaceId: workspaceId,
          updatedAt: now,
        },
        { merge: true },
      );
    });
    return {
      intent: input.intent,
      workspaceId,
      onboardingStatus: "personal_setup" as const,
    };
  }

  async select(uid: string, workspaceId: string) {
    if (
      !workspaceSelectionSchema.shape.workspaceId.safeParse(workspaceId).success
    )
      throw new ValidationError();
    const memberships = await this.db
      .collection("memberships")
      .where("userId", "==", uid)
      .get();
    const authorized = memberships.docs.some((doc) => {
      const data = doc.data();
      return (
        data.status === "active" &&
        (data.workspaceId === workspaceId ||
          data.organizationId === workspaceId)
      );
    });
    if (!authorized) throw new AuthorizationError();
    await this.db.doc(`users/${uid}`).set(
      {
        activeWorkspaceId: workspaceId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { activeWorkspaceId: workspaceId };
  }
}
