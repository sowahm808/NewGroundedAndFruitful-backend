import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { ValidationError } from "../../shared/errors.js";
import {
  authorizedClaims,
  effectiveRoles,
  normalizePlatformRoles,
  synchronizeClaims,
} from "../claims.js";
import { normalizeRoles } from "../roles.js";

export interface RepairPlatformRoleInput {
  uid: string;
  role: "super_admin";
  dryRun: boolean;
  actor: string;
}

export async function repairPlatformRole(
  auth: Auth,
  db: Firestore,
  input: RepairPlatformRoleInput,
): Promise<{
  eligible: boolean;
  changed: boolean;
  audited: boolean;
  tokenRefreshRequired: boolean;
}> {
  if (!input.uid.trim())
    throw new ValidationError(
      "An explicit UID and recognized platform role are required.",
    );
  const [authUser, profile, migration, memberships, revocations] =
    await Promise.all([
      auth.getUser(input.uid),
      db.doc(`users/${input.uid}`).get(),
      db.doc(`migrationRecords/legacy-bootstrap-${input.uid}`).get(),
      db.collection("memberships").where("userId", "==", input.uid).get(),
      db
        .collection("auditLogs")
        .where("targetUid", "==", input.uid)
        .where("event", "==", "PLATFORM_ROLE_REVOKED")
        .get(),
    ]);
  const profileRoles = normalizeRoles(
    profile.get("roles") ?? profile.get("role"),
  ).roles;
  const trustedMigration =
    migration.exists &&
    migration.get("type") === "legacy_authorization_bootstrap" &&
    migration.get("status") === "complete" &&
    profileRoles.includes("super_admin");
  const explicitlyRevoked = revocations.docs.some(
    (doc) => doc.get("role") === input.role,
  );
  const eligible = trustedMigration && !explicitlyRevoked && !authUser.disabled;
  if (!eligible)
    return {
      eligible: false,
      changed: false,
      audited: false,
      tokenRefreshRequired: false,
    };
  const membershipRoles = activeMembershipRoles(memberships.docs);
  const existingPlatformRoles = normalizePlatformRoles(
    authUser.customClaims?.platformRoles,
  );
  const changed = !existingPlatformRoles.includes(input.role);
  if (input.dryRun)
    return {
      eligible: true,
      changed,
      audited: false,
      tokenRefreshRequired: changed,
    };

  const synchronized = await synchronizeClaims(auth, input.uid, (fresh) => {
    const platformRoles = [
      ...new Set([
        ...normalizePlatformRoles(fresh.customClaims?.platformRoles),
        input.role,
      ]),
    ];
    return authorizedClaims(
      fresh.customClaims ?? {},
      platformRoles,
      effectiveRoles(platformRoles, membershipRoles),
    );
  });
  const auditId = `role-repair-${input.uid}-${input.role}`;
  await db.doc(`migrationRecords/${auditId}`).set(
    {
      type: "platform_role_repair",
      uid: input.uid,
      role: input.role,
      evidence: `legacy-bootstrap-${input.uid}`,
      actorId: input.actor,
      status: "complete",
      changed: synchronized.changed,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return {
    eligible: true,
    changed: synchronized.changed,
    audited: true,
    tokenRefreshRequired: synchronized.changed,
  };
}

/** Dedicated privileged revocation; membership records are deliberately untouched. */
export async function revokePlatformRole(
  auth: Auth,
  db: Firestore,
  input: { uid: string; role: "super_admin"; actor: string; reason: string },
): Promise<{ changed: boolean; tokenRefreshRequired: boolean }> {
  if (!input.uid.trim() || !input.actor.trim() || !input.reason.trim())
    throw new ValidationError(
      "UID, authorized actor, and reason are required.",
    );
  const profileRef = db.doc(`users/${input.uid}`);
  const memberships = await db
    .collection("memberships")
    .where("userId", "==", input.uid)
    .get();
  const changed = await db.runTransaction(async (transaction) => {
    const profile = await transaction.get(profileRef);
    const roles = normalizeRoles(
      profile.get("roles") ?? profile.get("role"),
    ).roles;
    const next = roles.filter((role) => role !== input.role);
    if (next.length === roles.length) return false;
    transaction.update(profileRef, {
      roles: next,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: input.actor,
    });
    transaction.create(db.collection("auditLogs").doc(), {
      event: "PLATFORM_ROLE_REVOKED",
      targetUid: input.uid,
      role: input.role,
      actorId: input.actor,
      reason: input.reason,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  const membershipRoles = activeMembershipRoles(memberships.docs);
  const synchronized = await synchronizeClaims(auth, input.uid, (fresh) =>
    authorizedClaims(fresh.customClaims ?? {}, [], membershipRoles),
  );
  return { changed, tokenRefreshRequired: synchronized.changed };
}

function activeMembershipRoles(
  documents: Array<{ get(field: string): unknown }>,
): ReturnType<typeof normalizeRoles>["roles"] {
  const roles: ReturnType<typeof normalizeRoles>["roles"] = [];
  for (const document of documents) {
    if (document.get("status") !== "active") continue;
    for (const role of normalizeRoles(document.get("roles")).roles)
      if (!roles.includes(role)) roles.push(role);
  }
  return roles;
}
