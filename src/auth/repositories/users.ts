import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import type { UserProfile } from "../models/user.js";
import { canonicalRoleSchema } from "../roles.js";

const collection = "users";
const userProfileDocument = z
  .object({
    uid: z.string().min(1),
    email: z.string().email().nullable(),
    displayName: z.string(),
    roles: z.array(canonicalRoleSchema),
    status: z.enum(["active", "disabled"]),
    createdAt: z.unknown().optional(),
    updatedAt: z.unknown().optional(),
    activeWorkspaceId: z.string().nullable().optional(),
    onboardingStatus: z
      .enum([
        "personal_setup",
        "organization_setup",
        "personal_workspace_required",
        "organization_setup_required",
        "registration_intent_required",
      ])
      .optional(),
    registrationIntent: z
      .enum(["personal", "organization"])
      .nullable()
      .optional(),
  })
  .passthrough();

const parseUserProfile = (value: unknown): UserProfile => {
  const parsed = userProfileDocument.parse(value);
  return {
    uid: parsed.uid,
    email: parsed.email,
    displayName: parsed.displayName,
    roles: parsed.roles,
    status: parsed.status,
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
    return parseUserProfile(snapshot.data());
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

      const current = parseUserProfile(snapshot.data());
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
