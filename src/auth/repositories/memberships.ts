import type { Firestore } from "firebase-admin/firestore";
import type { MembershipStatus } from "../models/user.js";

export interface StoredMembership {
  organizationId: string;
  userId: string;
  roles?: unknown;
  role?: unknown;
  status: MembershipStatus;
}

export class MembershipRepository {
  constructor(private readonly db: Firestore) {}

  async listForUser(uid: string): Promise<StoredMembership[]> {
    const snapshot = await this.db
      .collection("memberships")
      .where("userId", "==", uid)
      .get();
    return snapshot.docs.map((doc) => doc.data() as StoredMembership);
  }

  async hasActiveChildContext(uid: string, organizationIds: string[]): Promise<boolean> {
    if (organizationIds.length === 0) return false;
    const snapshots = await Promise.all(organizationIds.map((organizationId) =>
      this.db.collection("participants")
        .where("firebaseUid", "==", uid)
        .where("organizationId", "==", organizationId)
        .where("status", "==", "active")
        .get(),
    ));
    return snapshots.some((snapshot) => !snapshot.empty);
  }
}
