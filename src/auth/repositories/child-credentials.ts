import { createHmac } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { env } from "../../config/env.js";

const credentialSchema = z
  .object({
    participantId: z.string().min(1),
    firebaseUid: z.string().min(1),
    organizationId: z.string().min(1),
    pinHash: z.string().startsWith("$argon2id$"),
    failedAttempts: z.number().int().nonnegative(),
    lockedUntil: z.instanceof(Timestamp).nullable().optional(),
    disabled: z.boolean().optional(),
  })
  .passthrough();
const membershipSchema = z.object({
  userId: z.string(),
  participantId: z.string(),
  organizationId: z.string(),
  roles: z.array(z.string()),
  status: z.literal("active"),
});
export type Credential = z.infer<typeof credentialSchema>;

export class ChildCredentialRepository {
  constructor(private readonly db: Firestore) {}
  key(familyCode: string, handle: string) {
    return credentialLookupDigest(familyCode, handle);
  }

  async findActiveChildMembership(credential: Credential) {
    const snapshot = await this.db
      .collection("memberships")
      .where("userId", "==", credential.firebaseUid)
      .get();
    const matches = snapshot.docs.flatMap((document) => {
      const parsed = membershipSchema.safeParse(document.data());
      return parsed.success &&
        parsed.data.roles.includes("child") &&
        parsed.data.participantId === credential.participantId &&
        parsed.data.organizationId === credential.organizationId
        ? [{ id: document.id, organizationId: parsed.data.organizationId }]
        : [];
    });
    return matches.length === 1 ? matches[0] : undefined;
  }

  async hasActiveContext(credential: Credential): Promise<boolean> {
    const [participant, organization] = await Promise.all([
      this.db.doc(`participants/${credential.participantId}`).get(),
      this.db.doc(`organizations/${credential.organizationId}`).get(),
    ]);
    const p = z
      .object({
        firebaseUid: z.string(),
        organizationId: z.string(),
        status: z.literal("active"),
      })
      .safeParse(participant.data());
    const o = z
      .object({ status: z.literal("active") })
      .safeParse(organization.data());
    return (
      p.success &&
      o.success &&
      p.data.firebaseUid === credential.firebaseUid &&
      p.data.organizationId === credential.organizationId
    );
  }

  async find(familyCode: string, handle: string) {
    const snapshot = await this.existingSnapshot(familyCode, handle);
    const parsed = parseCredential(snapshot.data());
    return parsed.success ? parsed.data : undefined;
  }

  async recordFailure(familyCode: string, handle: string) {
    const ref = (await this.existingSnapshot(familyCode, handle)).ref;
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const parsed = parseCredential(snap.data());
      if (
        !parsed.success ||
        (parsed.data.lockedUntil?.toMillis() ?? 0) > Date.now()
      )
        return;
      const attempts = parsed.data.failedAttempts + 1;
      tx.update(ref, {
        failedAttempts: attempts,
        lockedUntil:
          attempts >= 5 ? Timestamp.fromMillis(Date.now() + 15 * 60_000) : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
  async clearFailures(familyCode: string, handle: string) {
    const ref = (await this.existingSnapshot(familyCode, handle)).ref;
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      // Never clear an unknown, disabled, or concurrently replaced record.
      // This makes the successful-login reset atomic with its final persisted
      // credential-state validation.
      const parsed = parseCredential(snapshot.data());
      if (
        !parsed.success ||
        parsed.data.disabled ||
        (parsed.data.lockedUntil?.toMillis() ?? 0) > Date.now()
      )
        return false;
      transaction.update(ref, {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
  }

  private async existingSnapshot(familyCode: string, handle: string) {
    let snapshot = await this.db
      .doc(`childCredentials/${this.key(familyCode, handle)}`)
      .get();
    // Temporary bridge. No new credential is ever created under this plaintext
    // ID; only lockout metadata may update an existing legacy record.
    if (
      !snapshot.exists &&
      env.CHILD_CREDENTIAL_MIGRATION_MODE === "compatibility"
    ) {
      const legacyId = `${normalizeCredentialPart(familyCode)}_${normalizeCredentialPart(handle)}`;
      snapshot = await this.db.doc(`childCredentials/${legacyId}`).get();
    }
    return snapshot;
  }
}

const parseCredential = (data: unknown) => {
  const legacy = z
    .object({ passwordHash: z.string().startsWith("$argon2id$") })
    .passthrough()
    .safeParse(data);
  return credentialSchema.safeParse(
    legacy.success && !("pinHash" in legacy.data)
      ? { ...legacy.data, pinHash: legacy.data.passwordHash }
      : data,
  );
};

export function normalizeCredentialPart(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}
export function credentialLookupDigest(familyCode: string, handle: string) {
  return createHmac("sha256", env.CHILD_LOGIN_LOOKUP_SECRET)
    .update(
      `${normalizeCredentialPart(familyCode)}\n${normalizeCredentialPart(handle)}`,
    )
    .digest("hex");
}
