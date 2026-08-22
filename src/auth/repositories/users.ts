import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import type { UserProfile } from "../models/user.js";
import { canonicalRoleSchema } from "../roles.js";

const collection = "users";
const userProfileDocument = z
  .object({
    // Profiles predate the current schema, and authentication must still be
    // able to classify those accounts for recovery. Treat malformed legacy
    // identity fields as missing rather than allowing ZodError to turn a
    // valid Firebase login into a 500 response.
    uid: z.string().min(1).optional().catch(undefined),
    email: z.string().email().nullable().optional().catch(undefined),
    displayName: z.string().optional().catch(undefined),
    roles: z.array(canonicalRoleSchema).optional().catch(undefined),
    status: z.unknown().optional(),
    createdAt: z.unknown().optional(),
    updatedAt: z.unknown().optional(),
    activeWorkspaceId: z.string().nullable().optional().catch(undefined),
    onboardingStatus: z
      .enum([
        "personal_setup",
        "organization_setup",
        "personal_workspace_required",
        "organization_setup_required",
        "registration_intent_required",
        "complete",
      ])
      .optional()
      .catch(undefined),
    registrationIntent: z
      .enum(["personal", "organization"])
      .nullable()
      .optional()
      .catch(undefined),
  })
  .passthrough();

const parseUserProfile = (uid: string, value: unknown): UserProfile => {
  const parsed = userProfileDocument.parse(value);
  return {
    // The document path is the trusted identity. A stale or corrupt embedded
    // uid must never cause the session to be issued for another user.
    uid,
    email: parsed.email ?? null,
    displayName: parsed.displayName ?? "",
    roles: parsed.roles ?? [],
    status:
      parsed.status === undefined || parsed.status === "active"
        ? "active"
        : "disabled",
    ...(parsed.activeWorkspaceId
      ? { activeWorkspaceId: parsed.activeWorkspaceId }
      : {}),
    ...(parsed.onboardingStatus
      ? { onboardingStatus: parsed.onboardingStatus }
      : {}),
    ...(parsed.registrationIntent
      ? { registrationIntent: parsed.registrationIntent }
      : {}),
  };
};

export interface ProvisionUserProfileInput {
  uid: string;
  email: string | null;
  displayName: string;
}

export class UserRepository {
  constructor(public readonly firestore: Firestore) {}

  async getUserByUid(uid: string): Promise<UserProfile | null> {
    const snapshot = await this.firestore.doc(`${collection}/${uid}`).get();
    if (!snapshot.exists) return null;
    return parseUserProfile(uid, snapshot.data());
  }

  async provisionUserProfile(
    input: ProvisionUserProfileInput,
  ): Promise<UserProfile> {
    const ref = this.firestore.doc(`${collection}/${input.uid}`);
    return this.firestore.runTransaction(async (transaction: Transaction) => {
      const snapshot = await transaction.get(ref);
      const now = FieldValue.serverTimestamp();
      if (!snapshot.exists) {
        transaction.set(ref, {
          uid: input.uid,
          email: input.email,
          displayName: input.displayName,
          roles: [],
          status: "active",
          registrationIntent: null,
          onboardingStatus: "registration_intent_required",
          memberships: [],
          activeWorkspaceId: null,
          createdAt: now,
          updatedAt: now,
        });
        return {
          uid: input.uid,
          email: input.email,
          displayName: input.displayName,
          roles: [],
          status: "active",
          onboardingStatus: "registration_intent_required",
        };
      }

      const current = parseUserProfile(input.uid, snapshot.data());
      const patch: Record<string, unknown> = {};
      if (current.uid !== input.uid) patch.uid = input.uid;
      if (typeof current.email === "undefined") patch.email = input.email;
      if (!current.displayName && input.displayName)
        patch.displayName = input.displayName;
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = now;
        transaction.set(ref, patch, { merge: true });
      }
      return { ...current, ...patch };
    });
  }
}
