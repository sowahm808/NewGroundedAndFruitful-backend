import { randomInt, randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { env } from "../../config/env.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors.js";
import {
  credentialLookupDigest,
  normalizeCredentialPart,
} from "../repositories/child-credentials.js";

const inputSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(128),
    participantId: z.string().trim().min(1).max(128),
    familyAccessId: z.string().trim().min(1).max(128),
    actorUid: z.string().trim().min(1).max(128),
    handle: z
      .string()
      .transform(normalizeCredentialPart)
      .pipe(
        z
          .string()
          .min(2)
          .max(24)
          .regex(/^[a-z0-9][a-z0-9._-]*$/),
      ),
    familyCode: z
      .string()
      .transform(normalizeCredentialPart)
      .pipe(
        z
          .string()
          .min(8)
          .max(24)
          .regex(/^[a-z0-9_-]+$/),
      )
      .optional(),
    pin: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict();
export type ChildCredentialProvisionInput = z.input<typeof inputSchema>;
export interface ProvisionedChildCredential {
  firebaseUid: string;
  familyCode: string;
  handle: string;
  pin: string;
  generatedFamilyCode: boolean;
}

const recordSchemas = {
  org: z.object({ status: z.literal("active") }),
  participant: z
    .object({
      organizationId: z.string(),
      status: z.literal("active"),
      firebaseUid: z.string().optional(),
    })
    .passthrough(),
  family: z
    .object({
      organizationId: z.string(),
      status: z.literal("active"),
      allowParentCredentialManagement: z.boolean().optional(),
    })
    .passthrough(),
  membership: z
    .object({
      organizationId: z.string(),
      userId: z.string(),
      status: z.literal("active"),
      roles: z.array(z.string()),
    })
    .passthrough(),
  link: z.object({
    organizationId: z.string(),
    participantId: z.string(),
    parentUid: z.string(),
    status: z.literal("active"),
  }),
};

/** Server-admin boundary. Raw secrets are returned to its caller and are never persisted or logged. */
export async function provisionChildCredential(
  auth: Auth,
  db: Firestore,
  raw: ChildCredentialProvisionInput,
): Promise<ProvisionedChildCredential> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError("Invalid child credential provisioning input.");
  const input = parsed.data;
  const familyCode = input.familyCode ?? generateFamilyCode();
  const pin = input.pin ?? generatePin();
  const lookupDigest = credentialLookupDigest(familyCode, input.handle);
  const pinHash = await hash(`${pin}${env.CHILD_LOGIN_PEPPER}`, {
    algorithm: 2,
  });

  const participantBefore = await db
    .doc(`participants/${input.participantId}`)
    .get();
  const existingUid = z
    .object({ firebaseUid: z.string().optional() })
    .safeParse(participantBefore.data()).data?.firebaseUid;
  let uid = existingUid;
  let createdUid: string | undefined;
  if (!uid) {
    const user = await auth.createUser({
      disabled: false,
      displayName: "Child account",
    });
    uid = user.uid;
    createdUid = uid;
  }
  try {
    await db.runTransaction(async (tx) => {
      const orgRef = db.doc(`organizations/${input.organizationId}`),
        participantRef = db.doc(`participants/${input.participantId}`);
      const familyRef = db.doc(`familyAccess/${input.familyAccessId}`),
        credentialRef = db.doc(`childCredentials/${lookupDigest}`);
      const [
        org,
        participant,
        family,
        actorMemberships,
        links,
        credential,
        participantCredentials,
      ] = await Promise.all([
        tx.get(orgRef),
        tx.get(participantRef),
        tx.get(familyRef),
        tx.get(
          db.collection("memberships").where("userId", "==", input.actorUid),
        ),
        tx.get(
          db
            .collection("parentChildLinks")
            .where("parentUid", "==", input.actorUid)
            .where("participantId", "==", input.participantId)
            .where("status", "==", "active"),
        ),
        tx.get(credentialRef),
        tx.get(
          db
            .collection("childCredentials")
            .where("participantId", "==", input.participantId)
            .where("disabled", "==", false),
        ),
      ]);
      const o = recordSchemas.org.safeParse(org.data()),
        p = recordSchemas.participant.safeParse(participant.data()),
        f = recordSchemas.family.safeParse(family.data());
      if (!org.exists || !o.success)
        throw new NotFoundError("Active organization not found.");
      if (
        !participant.exists ||
        !p.success ||
        p.data.organizationId !== input.organizationId
      )
        throw new NotFoundError("Active participant not found.");
      if (
        !family.exists ||
        !f.success ||
        f.data.organizationId !== input.organizationId
      )
        throw new NotFoundError("Active family access not found.");
      const isAdmin = actorMemberships.docs.some((d) => {
        const m = recordSchemas.membership.safeParse(d.data());
        return (
          m.success &&
          m.data.organizationId === input.organizationId &&
          m.data.roles.includes("super_admin")
        );
      });
      const isParent =
        f.data.allowParentCredentialManagement === true &&
        links.docs.some((d) => {
          const l = recordSchemas.link.safeParse(d.data());
          return l.success && l.data.organizationId === input.organizationId;
        });
      if (!isAdmin && !isParent)
        throw new NotFoundError("Authorized provisioning context not found.");
      if (p.data.firebaseUid && p.data.firebaseUid !== uid)
        throw new ConflictError("Participant identity changed; retry safely.");
      if (!credential.exists && !participantCredentials.empty)
        throw new ConflictError("An active child credential already exists.");
      if (
        credential.exists &&
        (credential.get("participantId") !== input.participantId ||
          credential.get("firebaseUid") !== uid)
      )
        throw new ConflictError("Handle is already active in this family.");
      const membershipId = `child-${input.organizationId}-${input.participantId}`;
      const membershipRef = db.doc(`memberships/${membershipId}`);
      const membership = await tx.get(membershipRef);
      if (
        membership.exists &&
        (membership.get("userId") !== uid ||
          membership.get("organizationId") !== input.organizationId)
      )
        throw new ConflictError("Conflicting child membership exists.");
      const now = FieldValue.serverTimestamp();
      tx.update(participantRef, { firebaseUid: uid, updatedAt: now });
      tx.set(
        membershipRef,
        {
          userId: uid,
          participantId: input.participantId,
          organizationId: input.organizationId,
          roles: ["child"],
          status: "active",
          updatedAt: now,
          createdAt: membership.exists
            ? (membership.get("createdAt") ?? now)
            : now,
        },
        { merge: true },
      );
      tx.set(
        credentialRef,
        {
          participantId: input.participantId,
          firebaseUid: uid,
          organizationId: input.organizationId,
          familyAccessId: input.familyAccessId,
          normalizedHandle: input.handle,
          pinHash,
          disabled: false,
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: now,
          createdAt: credential.exists
            ? (credential.get("createdAt") ?? now)
            : now,
        },
        { merge: true },
      );
      tx.create(db.collection("auditLogs").doc(), {
        event: credential.exists
          ? "CHILD_CREDENTIAL_REPROVISIONED"
          : "CHILD_CREDENTIAL_PROVISIONED",
        actorId: input.actorUid,
        organizationId: input.organizationId,
        participantId: input.participantId,
        credentialId: lookupDigest,
        createdAt: now,
      });
    });
  } catch (error) {
    if (createdUid) await auth.deleteUser(createdUid).catch(() => undefined);
    throw error;
  }
  return {
    firebaseUid: uid,
    familyCode,
    handle: input.handle,
    pin,
    generatedFamilyCode: !input.familyCode,
  };
}

export function generatePin() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
export function generateFamilyCode() {
  return randomBytes(10).toString("base64url").toLowerCase();
}

export async function rotateChildPin(
  auth: Auth,
  db: Firestore,
  familyCode: string,
  handle: string,
  pin?: string,
) {
  const next = pin ?? generatePin();
  if (!/^\d{6}$/.test(next))
    throw new ValidationError("PIN must contain exactly six digits.");
  const ref = db.doc(
      `childCredentials/${credentialLookupDigest(familyCode, handle)}`,
    ),
    snapshot = await ref.get();
  if (!snapshot.exists) throw new NotFoundError();
  await ref.update({
    pinHash: await hash(`${next}${env.CHILD_LOGIN_PEPPER}`, { algorithm: 2 }),
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await auth.revokeRefreshTokens(String(snapshot.get("firebaseUid")));
  return { pin: next };
}

export async function setChildLoginEnabled(
  auth: Auth,
  db: Firestore,
  familyCode: string,
  handle: string,
  enabled: boolean,
) {
  const ref = db.doc(
      `childCredentials/${credentialLookupDigest(familyCode, handle)}`,
    ),
    snapshot = await ref.get();
  if (!snapshot.exists) throw new NotFoundError();
  await ref.update({
    disabled: !enabled,
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await auth.revokeRefreshTokens(String(snapshot.get("firebaseUid")));
}

export async function changeChildHandle(
  auth: Auth,
  db: Firestore,
  familyCode: string,
  oldHandle: string,
  newHandle: string,
) {
  const normalized = normalizeCredentialPart(newHandle);
  if (!/^[a-z0-9][a-z0-9._-]{1,23}$/.test(normalized))
    throw new ValidationError("Invalid handle.");
  await moveCredential(
    auth,
    db,
    credentialLookupDigest(familyCode, oldHandle),
    credentialLookupDigest(familyCode, normalized),
    normalized,
  );
}

export async function rotateFamilyCode(
  auth: Auth,
  db: Firestore,
  familyAccessId: string,
) {
  const nextCode = generateFamilyCode();
  const records = await db
    .collection("childCredentials")
    .where("familyAccessId", "==", familyAccessId)
    .get();
  if (records.empty) throw new NotFoundError();
  await db.runTransaction(async (tx) => {
    const destinations = records.docs.map((doc) => ({
      source: doc,
      ref: db.doc(
        `childCredentials/${credentialLookupDigest(nextCode, String(doc.get("normalizedHandle")))}`,
      ),
    }));
    const checks = await Promise.all(
      destinations.map((item) => tx.get(item.ref)),
    );
    if (checks.some((snapshot) => snapshot.exists))
      throw new ConflictError("Family-code rotation collision.");
    for (const item of destinations) {
      tx.create(item.ref, {
        ...item.source.data(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.delete(item.source.ref);
    }
  });
  await Promise.all(
    [...new Set(records.docs.map((doc) => String(doc.get("firebaseUid"))))].map(
      (uid) => auth.revokeRefreshTokens(uid),
    ),
  );
  return { familyCode: nextCode };
}

async function moveCredential(
  auth: Auth,
  db: Firestore,
  sourceId: string,
  destinationId: string,
  normalizedHandle: string,
) {
  let uid = "";
  await db.runTransaction(async (tx) => {
    const source = await tx.get(db.doc(`childCredentials/${sourceId}`));
    const destination = await tx.get(
      db.doc(`childCredentials/${destinationId}`),
    );
    if (!source.exists) throw new NotFoundError();
    if (destination.exists)
      throw new ConflictError("Handle is already active in this family.");
    uid = String(source.get("firebaseUid"));
    tx.create(destination.ref, {
      ...source.data(),
      normalizedHandle,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.delete(source.ref);
  });
  await auth.revokeRefreshTokens(uid);
}
