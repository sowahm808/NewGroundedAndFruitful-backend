import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { UserProfile } from "../models/user.js";

const collection = "users";

export interface ProvisionUserProfileInput {
  uid: string;
  email: string | null;
  displayName: string;
}

export class UserRepository {
  constructor(private readonly db: Firestore) {}

  async getUserByUid(uid: string): Promise<UserProfile | null> {
    const snapshot = await this.db.doc(`${collection}/${uid}`).get();
    if (!snapshot.exists) return null;
    return snapshot.data() as UserProfile;
  }

  async provisionUserProfile(
    input: ProvisionUserProfileInput,
  ): Promise<UserProfile> {
    const ref = this.db.doc(`${collection}/${input.uid}`);
    return this.db.runTransaction(async (transaction: Transaction) => {
      const snapshot = await transaction.get(ref);
      const now = FieldValue.serverTimestamp();
      if (!snapshot.exists) {
        transaction.set(ref, {
          uid: input.uid,
          email: input.email,
          displayName: input.displayName,
          roles: [],
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
        return {
          uid: input.uid,
          email: input.email,
          displayName: input.displayName,
          roles: [],
          status: "active",
        };
      }

      const current = snapshot.data() as UserProfile;
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
