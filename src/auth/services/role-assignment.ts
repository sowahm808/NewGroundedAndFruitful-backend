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

const inputSchema = z.object({
  uid: z.string().trim().min(1).max(128),
  role: canonicalRoleSchema,
  replace: z.boolean().default(false),
  updatedBy: z.string().trim().min(1).max(128),
});

export interface AssignRoleInput {
  uid: string;
  role: Role;
  replace?: boolean;
  updatedBy: string;
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
    const changed =
      roles.length !== existing.length ||
      roles.some((role, index) => role !== existing[index]);
    if (changed) {
      transaction.update(userRef, {
        roles,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: input.updatedBy,
      });
      transaction.set(auditRef, {
        event: "USER_ROLE_ASSIGNED",
        targetUid: input.uid,
        role: input.role,
        mode: input.replace ? "replace" : "add",
        updatedBy: input.updatedBy,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { roles, changed };
  });

  const currentClaims = authUser.customClaims ?? {};
  try {
    await auth.setCustomUserClaims(input.uid, {
      ...currentClaims,
      roles: result.roles,
      role: result.roles[0] ?? null,
    });
    return { ...result, claimsSynchronized: true };
  } catch (error) {
    await db.collection("auditLogs").add({
      event: "USER_ROLE_CLAIM_SYNC_FAILED",
      targetUid: input.uid,
      updatedBy: input.updatedBy,
      retryable: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    throw error;
  }
}

function firebaseCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
