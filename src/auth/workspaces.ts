import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import {
  AuthorizationError,
  ConflictError,
  ValidationError,
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
      await this.db
        .doc(`users/${uid}`)
        .set(
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
          roles: ["admin"],
          workspaceRoles: ["owner"],
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
    await this.db
      .doc(`users/${uid}`)
      .set(
        {
          activeWorkspaceId: workspaceId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    return { activeWorkspaceId: workspaceId };
  }
}
