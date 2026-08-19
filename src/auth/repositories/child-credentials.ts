import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
export interface Credential {
  participantId: string;
  firebaseUid: string;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil?: Timestamp;
  disabled?: boolean;
}
export class ChildCredentialRepository {
  constructor(private db: Firestore) {}
  key(familyCode: string, handle: string) {
    return `${normalizeCredentialPart(familyCode)}_${normalizeCredentialPart(handle)}`;
  }

  async findActiveChildMembership(
    credential: Credential,
  ): Promise<{ id: string; organizationId: string } | undefined> {
    const snapshot = await this.db
      .collection("memberships")
      .where("userId", "==", credential.firebaseUid)
      .get();
    const matches = snapshot.docs.filter((document) => {
      const value = document.data();
      const roles = Array.isArray(value.roles) ? value.roles : [value.role];
      return (
        value.userId === credential.firebaseUid &&
        value.status === "active" &&
        roles.includes("child") &&
        (value.participantId === undefined ||
          value.participantId === credential.participantId)
      );
    });
    if (matches.length !== 1) return undefined;
    return {
      id: matches[0]!.id,
      organizationId: String(matches[0]!.get("organizationId")),
    };
  }
  async find(f: string, h: string) {
    return (
      await this.db.doc(`childCredentials/${this.key(f, h)}`).get()
    ).data() as Credential | undefined;
  }
  async recordFailure(f: string, h: string) {
    const ref = this.db.doc(`childCredentials/${this.key(f, h)}`);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const value = snap.data() as Credential;
      if (value.lockedUntil && value.lockedUntil.toMillis() > Date.now())
        return;
      const attempts = value.failedAttempts + 1;
      tx.update(ref, {
        failedAttempts: attempts,
        lockedUntil:
          attempts >= 5 ? Timestamp.fromMillis(Date.now() + 15 * 60_000) : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
  async clearFailures(f: string, h: string) {
    await this.db.doc(`childCredentials/${this.key(f, h)}`).update({
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: FieldValue.serverTimestamp(),
    });
  }
}

export function normalizeCredentialPart(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}
