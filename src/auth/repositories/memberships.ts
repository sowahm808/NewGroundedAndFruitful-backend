import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";

const membershipDocument = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  roles: z.unknown().optional(),
  role: z.unknown().optional(),
  status: z.enum(["active", "pending", "suspended", "revoked"]),
  expiresAt: z.unknown().optional(),
}).passthrough();

export interface StoredMembership {
  organizationId: string;
  userId: string;
  roles?: unknown;
  role?: unknown;
  status: string;
  expiresAt?: unknown;
}

export class MembershipRepository {
  constructor(private readonly db: Firestore) {}

  async listForUser(uid: string): Promise<StoredMembership[]> {
    const snapshot = await this.db
      .collection("memberships")
      .where("userId", "==", uid)
      .get();
    return snapshot.docs.map((doc): StoredMembership => {
      const parsed = membershipDocument.safeParse(doc.data());
      if (parsed.success) return parsed.data;
      // Preserve an invalid row as an authorization fallback boundary. A
      // malformed membership must never make legacy profile roles usable.
      return { organizationId: "", userId: uid, status: "invalid" };
    });
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
