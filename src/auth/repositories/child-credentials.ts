import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { RateLimitError } from "../../shared/errors.js";
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
    return `${familyCode.toLowerCase()}_${handle.toLowerCase()}`;
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
        throw new RateLimitError();
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
