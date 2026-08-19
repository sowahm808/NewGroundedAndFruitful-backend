import { createHash } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";
import { normalizeRoles } from "../auth/roles.js";

const VERSION = 1;
const safeId = (...parts: string[]) =>
  createHash("sha256").update(parts.join("\0")).digest("hex");

export interface BootstrapOrganizationInput {
  name: string;
  timezone: string;
  environment: "development" | "staging" | "production";
  confirmed: boolean;
  actor: string;
  dryRun?: boolean;
}

export interface BootstrapReport {
  organizationId: string;
  outcome: "created" | "existing" | "would_create";
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

/** Creates the sole initial organization, or returns the exact existing record. */
export async function bootstrapOrganization(
  db: Firestore,
  raw: BootstrapOrganizationInput,
): Promise<BootstrapReport> {
  const parsed = z.object({
    name: z.string().trim().min(1).max(200),
    timezone: z.string().trim().min(1).max(100),
    environment: z.enum(["development", "staging", "production"]),
    confirmed: z.boolean(), actor: z.string().trim().min(1).max(128),
    dryRun: z.boolean().default(false),
  }).safeParse(raw);
  if (!parsed.success)
    throw new ValidationError("Invalid organization bootstrap input or IANA timezone.");
  if (!validTimezone(parsed.data.timezone))
    throw new ValidationError("Invalid organization bootstrap input or IANA timezone.");
  const input = parsed.data;
  if (input.environment === "production" && !input.confirmed)
    throw new ValidationError("Production bootstrap requires explicit confirmation.");
  const id = `org-${safeId(input.name, input.timezone).slice(0, 24)}`;
  return db.runTransaction(async (tx) => {
    const all = await tx.get(db.collection("organizations"));
    const exact = all.docs.filter((doc) => doc.get("name") === input.name && doc.get("timezone") === input.timezone);
    if (exact.length > 1 || (exact.length === 1 && all.size > 1)) throw new ConflictError("Ambiguous duplicate organizations require repair.");
    if (exact.length === 1) {
      if (exact[0]!.get("status") !== "active" || exact[0]!.get("version") !== VERSION)
        throw new ConflictError("Matching organization is not an exact active version match.");
      return { organizationId: exact[0]!.id, outcome: "existing" };
    }
    if (!all.empty) throw new ConflictError("An organization already exists; initial bootstrap is refused.");
    if (input.dryRun) return { organizationId: id, outcome: "would_create" };
    const now = FieldValue.serverTimestamp();
    tx.create(db.doc(`organizations/${id}`), {
      name: input.name, status: "active", timezone: input.timezone, version: VERSION,
      createdAt: now, createdBy: input.actor, updatedAt: now, updatedBy: input.actor,
    });
    tx.create(db.doc(`auditLogs/bootstrap-${safeId(input.name, input.timezone)}`), {
      event: "ORGANIZATION_BOOTSTRAPPED", organizationId: id, version: VERSION,
      actor: input.actor, createdAt: now,
    });
    return { organizationId: id, outcome: "created" };
  });
}

export interface ProvisionChildInput {
  uid: string; organizationId: string; displayName: string;
  environment: "development" | "staging" | "production";
  confirmed: boolean; actor: string; dryRun?: boolean; parentUid?: string;
}
export interface ProvisionChildReport {
  uid: string; organizationId: string; membershipId: string; participantId: string;
  outcome: "provisioned" | "reconciled" | "unchanged" | "dry_run";
  changes: string[]; claims: "synchronized" | "retry_required" | "not_attempted";
}

/** Trusted and resumable identity-to-child-context reconciliation boundary. */
export async function provisionChild(auth: Auth, db: Firestore, raw: ProvisionChildInput): Promise<ProvisionChildReport> {
  const parsed = z.object({
    uid: z.string().trim().min(1).max(128), organizationId: z.string().trim().min(1).max(256),
    displayName: z.string().trim().min(1).max(200), environment: z.enum(["development", "staging", "production"]),
    confirmed: z.boolean(), actor: z.string().trim().min(1).max(128), dryRun: z.boolean().default(false),
    parentUid: z.string().trim().min(1).max(128).optional(),
  }).safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid child provisioning input.");
  const input = parsed.data;
  if (input.environment === "production" && !input.confirmed)
    throw new ValidationError("Production provisioning requires explicit confirmation.");
  const authUser = await auth.getUser(input.uid).catch((error: unknown) => {
    if (firebaseCode(error) === "auth/user-not-found") throw new NotFoundError("Firebase user not found.");
    throw error;
  });
  if (authUser.uid !== input.uid) throw new ConflictError("Firebase identity mismatch.");
  if (input.parentUid) await verifyParent(auth, db, input.parentUid, input.organizationId);

  const membershipId = `child-${safeId(input.organizationId, input.uid).slice(0, 32)}`;
  const participantId = `child-${safeId(input.uid, input.organizationId).slice(0, 32)}`;
  const membershipRef = db.doc(`memberships/${membershipId}`);
  const participantRef = db.doc(`participants/${participantId}`);
  const changes: string[] = [];
  const result = await db.runTransaction(async (tx) => {
    const [org, user, memberships, mapped, deterministicParticipant] = await Promise.all([
      tx.get(db.doc(`organizations/${input.organizationId}`)), tx.get(db.doc(`users/${input.uid}`)),
      tx.get(db.collection("memberships").where("userId", "==", input.uid)),
      tx.get(db.collection("participants").where("firebaseUid", "==", input.uid)), tx.get(participantRef),
    ]);
    if (!org.exists) throw new NotFoundError("Organization not found.");
    if (org.get("status") !== "active") throw new ConflictError("Organization is not active.");
    if (memberships.size > 1) throw new ConflictError("Duplicate memberships require repair.");
    const membership = memberships.docs[0];
    if (membership && membership.get("organizationId") !== input.organizationId)
      throw new ConflictError("Membership belongs to another organization.");
    if (membership && membership.get("status") !== "active")
      throw new ConflictError("Existing child membership is not active and requires repair.");
    if (membership && !normalizeRoles(membership.get("roles") ?? membership.get("role")).roles.includes("child"))
      throw new ConflictError("Existing membership is not a child membership.");
    if (mapped.size > 1) throw new ConflictError("Duplicate participant mappings require repair.");
    const uidParticipant = mapped.docs[0];
    if (uidParticipant && uidParticipant.get("organizationId") !== input.organizationId)
      throw new ConflictError("Participant belongs to another organization.");
    const participant = uidParticipant ?? (deterministicParticipant.exists ? deterministicParticipant : undefined);
    if (participant && participant.get("organizationId") !== input.organizationId)
      throw new ConflictError("Participant belongs to another organization.");
    if (participant && participant.get("firebaseUid") && participant.get("firebaseUid") !== input.uid)
      throw new ConflictError("Participant is mapped to another identity.");
    if (participant && participant.get("status") !== "active")
      throw new ConflictError("Existing participant is not active and requires repair.");
    const targetMembership = membership?.ref ?? membershipRef;
    const targetParticipant = participant?.ref ?? participantRef;
    if (!user.exists) changes.push("user_created");
    else if (!normalizeRoles(user.get("roles") ?? user.get("role")).roles.includes("child")) changes.push("user_role_added");
    if (!membership) changes.push("membership_created");
    if (!participant) changes.push("participant_created");
    else if (!participant.get("firebaseUid")) changes.push("participant_uid_repaired");
    if (input.dryRun) return { targetMembership, targetParticipant };
    const now = FieldValue.serverTimestamp();
    const existingRoles = user.exists ? normalizeRoles(user.get("roles") ?? user.get("role")).roles : [];
    tx.set(db.doc(`users/${input.uid}`), {
      ...(user.exists ? {} : { uid: input.uid, email: authUser.email ?? null, displayName: input.displayName, status: "active", createdAt: now, createdBy: input.actor }),
      roles: [...new Set([...existingRoles, "child"])], version: VERSION, updatedAt: now, updatedBy: input.actor,
      provisioningState: "claims_pending",
    }, { merge: true });
    if (!membership) tx.create(targetMembership, { userId: input.uid, organizationId: input.organizationId, roles: ["child"], status: "active", participantId: targetParticipant.id, version: VERSION, createdAt: now, createdBy: input.actor, updatedAt: now, updatedBy: input.actor });
    if (!participant) tx.create(targetParticipant, { firebaseUid: input.uid, organizationId: input.organizationId, displayName: input.displayName, status: "active", version: VERSION, createdAt: now, createdBy: input.actor, updatedAt: now, updatedBy: input.actor });
    else if (!participant.get("firebaseUid")) tx.update(targetParticipant, { firebaseUid: input.uid, version: VERSION, updatedAt: now, updatedBy: input.actor });
    if (input.parentUid) {
      const link = db.doc(`parentChildLinks/${safeId(input.organizationId, input.parentUid, targetParticipant.id)}`);
      tx.set(link, { parentUid: input.parentUid, participantId: targetParticipant.id, organizationId: input.organizationId, status: "active", version: VERSION, createdAt: now, createdBy: input.actor, updatedAt: now, updatedBy: input.actor }, { merge: true });
      changes.push("parent_link_reconciled");
    }
    tx.set(db.doc(`auditLogs/child-provision-${safeId(input.organizationId, input.uid)}`), { event: "CHILD_PROVISIONED", targetUid: input.uid, organizationId: input.organizationId, membershipId: targetMembership.id, participantId: targetParticipant.id, changes, version: VERSION, actor: input.actor, createdAt: now, updatedAt: now }, { merge: true });
    return { targetMembership, targetParticipant };
  });
  if (input.dryRun) return report("dry_run", "not_attempted", result.targetMembership, result.targetParticipant);
  let claims: ProvisionChildReport["claims"] = "synchronized";
  try {
    const roles = normalizeRoles(authUser.customClaims?.roles).roles;
    await auth.setCustomUserClaims(input.uid, { ...authUser.customClaims, roles: [...new Set([...roles, "child"])] });
    await db.doc(`users/${input.uid}`).set({ provisioningState: "complete", claimsSynchronizedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: input.actor }, { merge: true });
  } catch {
    claims = "retry_required";
    await db.doc(`users/${input.uid}`).set({ provisioningState: "claims_pending", claimSyncRetryRequired: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: input.actor }, { merge: true });
  }
  return report(changes.length === 0 ? "unchanged" : "reconciled", claims, result.targetMembership, result.targetParticipant);

  function report(outcome: ProvisionChildReport["outcome"], claimState: ProvisionChildReport["claims"], membership: DocumentReference, participant: DocumentReference): ProvisionChildReport {
    return { uid: input.uid, organizationId: input.organizationId, membershipId: membership.id, participantId: participant.id, outcome, changes: [...changes], claims: claimState };
  }
}

async function verifyParent(auth: Auth, db: Firestore, uid: string, organizationId: string): Promise<void> {
  await auth.getUser(uid).catch(() => { throw new NotFoundError("Parent Firebase user not found."); });
  const memberships = await db.collection("memberships").where("userId", "==", uid).get();
  const authorized = memberships.docs.filter((doc) => doc.get("organizationId") === organizationId && doc.get("status") === "active" && normalizeRoles(doc.get("roles") ?? doc.get("role")).roles.includes("parent"));
  if (authorized.length !== 1) throw new ConflictError("Exactly one active parent membership is required.");
}

function firebaseCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
