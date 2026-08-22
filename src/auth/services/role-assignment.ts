import { createHash } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors.js";
import {
  canonicalRoleSchema,
  parseCanonicalRoles,
  type Role,
} from "../roles.js";
import {
  authorizedClaims,
  effectiveRoles,
  synchronizeClaims,
} from "../claims.js";

const inputSchema = z.object({
  uid: z.string().trim().min(1).max(128),
  role: canonicalRoleSchema,
  replace: z.boolean().default(false),
  updatedBy: z.string().trim().min(1).max(128),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .default("Operational role assignment"),
  requestId: z.string().trim().min(1).max(128).default("unspecified"),
  actorRoles: z.array(canonicalRoleSchema).default([]),
  initialBootstrap: z.boolean().default(false),
});

export interface AssignRoleInput {
  uid: string;
  role: Role;
  replace?: boolean;
  updatedBy: string;
  reason?: string;
  requestId?: string;
  actorRoles?: Role[];
  initialBootstrap?: boolean;
}

/** Trusted operational boundary. Firestore remains authoritative; claims are a cache. */
export async function assignRole(
  auth: Auth,
  db: Firestore,
  untrustedInput: AssignRoleInput,
): Promise<{ roles: Role[]; changed: boolean; claimsSynchronized: boolean }> {
  const parsed = inputSchema.safeParse(untrustedInput);
  if (!parsed.success)
    throw new ValidationError("Invalid role assignment input.");
  const input = parsed.data;

  if (
    (input.role === "admin" || input.role === "super_admin") &&
    !input.actorRoles.includes("super_admin") &&
    !input.initialBootstrap
  )
    throw new ValidationError(
      "A super_admin is required to assign an elevated role.",
    );
  if (input.initialBootstrap && input.role !== "super_admin")
    throw new ValidationError("Bootstrap may only provision super_admin.");

  if (input.initialBootstrap) {
    const existing = await db
      .collection("users")
      .where("status", "==", "active")
      .where("roles", "array-contains", "super_admin")
      .limit(1)
      .get();
    if (
      !existing.empty &&
      existing.docs.some((document) => document.id !== input.uid)
    )
      throw new ConflictError("Initial super_admin is already provisioned.");
  }

  const authUser = await auth.getUser(input.uid).catch((error: unknown) => {
    if (firebaseCode(error) === "auth/user-not-found")
      throw new NotFoundError("Target Firebase user not found.");
    throw error;
  });
  if (authUser.uid !== input.uid)
    throw new ConflictError("Firebase user identity did not match the target.");

  const userRef = db.doc(`users/${input.uid}`);
  const eventId = createHash("sha256")
    .update(`${input.uid}\0${input.role}\0${input.replace ? "replace" : "add"}`)
    .digest("hex");
  const auditRef = db.doc(`auditLogs/role-assignment-${eventId}`);

  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists)
      throw new NotFoundError("Target user profile not found.");
    const data = snapshot.data() ?? {};
    if (data.uid !== input.uid)
      throw new ConflictError(
        "User profile identity did not match the target.",
      );
    let existing: Role[];
    try {
      existing = parseCanonicalRoles(data.roles);
    } catch {
      throw new ValidationError(
        "Target user profile has invalid stored roles.",
      );
    }
    const roles = input.replace
      ? [input.role]
      : [...new Set([...existing, input.role])];
    if (
      input.replace &&
      existing.includes("super_admin") &&
      !roles.includes("super_admin")
    )
      throw new ConflictError(
        "Removing super_admin requires the dedicated guarded removal workflow.",
      );
    const changed =
      roles.length !== existing.length ||
      roles.some((role, index) => role !== existing[index]);
    if (changed) {
      transaction.update(userRef, {
        roles,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: input.updatedBy,
        reason: input.reason,
        requestId: input.requestId,
      });
      transaction.set(auditRef, {
        event: "USER_ROLE_ASSIGNED",
        targetUid: input.uid,
        role: input.role,
        mode: input.replace ? "replace" : "add",
        updatedBy: input.updatedBy,
        reason: input.reason,
        requestId: input.requestId,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { roles, changed };
  });

  try {
    const membershipSnapshot = await db
      .collection("memberships")
      .where("userId", "==", input.uid)
      .get();
    const membershipRoles: Role[] = [];
    for (const document of membershipSnapshot.docs) {
      if (document.get("status") !== "active") continue;
      for (const role of parseClaimRoles(document.get("roles")))
        if (!membershipRoles.includes(role)) membershipRoles.push(role);
    }
    const platformRoles = result.roles.includes("super_admin")
      ? (["super_admin"] as const)
      : [];
    await synchronizeClaims(auth, input.uid, (fresh) => {
      const roles = effectiveRoles(platformRoles, membershipRoles);
      return authorizedClaims(fresh.customClaims ?? {}, platformRoles, roles);
    });
    return { ...result, claimsSynchronized: true };
  } catch (error) {
    await db.collection("auditLogs").add({
      event: "USER_ROLE_CLAIM_SYNC_FAILED",
      targetUid: input.uid,
      updatedBy: input.updatedBy,
      reason: input.reason,
      requestId: input.requestId,
      updatedAt: FieldValue.serverTimestamp(),
      retryable: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    throw error;
  }
}

function parseClaimRoles(value: unknown): Role[] {
  const parsed = canonicalRoleSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

function firebaseCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
