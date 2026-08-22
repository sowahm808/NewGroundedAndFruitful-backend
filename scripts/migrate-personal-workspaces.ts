import { createHash, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../src/config/firebase.js";
import { normalizePersonas } from "../src/auth/capabilities.js";

const values = process.argv.slice(2);
const execute = values.includes("--execute");
const checkpoint = values.find((v) => v.startsWith("--checkpoint="))?.slice(13);
const limit = Number(
  values.find((v) => v.startsWith("--limit="))?.split("=")[1] ?? 200,
);
const confirmation = values.find((v) => v.startsWith("--confirm="))?.slice(10);
if (!Number.isInteger(limit) || limit < 1 || limit > 500)
  throw new Error("--limit must be between 1 and 500");

let query = db.collection("memberships").orderBy("__name__").limit(limit);
if (checkpoint) query = query.startAfter(checkpoint);
const snapshot = await query.get();
const candidates: Array<{
  membershipId: string;
  userId: string;
  workspaceId: string;
  before: string[];
}> = [];
const ambiguous: Array<{ membershipId: string; reason: string }> = [];
let alreadyCanonical = 0;

for (const membership of snapshot.docs) {
  const row = membership.data();
  const userId = typeof row.userId === "string" ? row.userId : "";
  const workspaceId =
    typeof row.workspaceId === "string"
      ? row.workspaceId
      : typeof row.organizationId === "string"
        ? row.organizationId
        : "";
  if (!userId || !workspaceId || row.status !== "active") continue;
  const [workspace, user] = await Promise.all([
    db.doc(`workspaces/${workspaceId}`).get(),
    db.doc(`users/${userId}`).get(),
  ]);
  if (!workspace.exists || workspace.get("type") !== "personal") continue;
  if (workspace.get("ownerUserId") !== userId) {
    ambiguous.push({ membershipId: membership.id, reason: "owner_mismatch" });
    continue;
  }
  if (!user.exists || user.get("registrationIntent") !== "personal") {
    ambiguous.push({
      membershipId: membership.id,
      reason: "personal_intent_unconfirmed",
    });
    continue;
  }
  const before = normalizePersonas(row.personas);
  if (before.includes("parent")) {
    alreadyCanonical++;
    continue;
  }
  candidates.push({ membershipId: membership.id, userId, workspaceId, before });
}

const nextCheckpoint = snapshot.docs.at(-1)?.id ?? checkpoint ?? null;
const digest = createHash("sha256")
  .update(
    JSON.stringify({
      checkpoint: checkpoint ?? null,
      nextCheckpoint,
      candidates: candidates.map((c) => c.membershipId),
    }),
  )
  .digest("hex")
  .slice(0, 24);
if (execute && confirmation !== digest)
  throw new Error(
    `Execution requires a reviewed dry run: rerun with --execute --confirm=${digest}`,
  );

const runId = `personal-parent-persona-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
if (execute) {
  for (const candidate of candidates) {
    await db.runTransaction(async (tx) => {
      const membershipRef = db.doc(`memberships/${candidate.membershipId}`);
      const current = await tx.get(membershipRef);
      if (
        !current.exists ||
        normalizePersonas(current.get("personas")).includes("parent")
      )
        return;
      // Revalidate every authoritative boundary inside the write transaction.
      const [workspace, user] = await Promise.all([
        tx.get(db.doc(`workspaces/${candidate.workspaceId}`)),
        tx.get(db.doc(`users/${candidate.userId}`)),
      ]);
      if (
        current.get("status") !== "active" ||
        current.get("userId") !== candidate.userId ||
        workspace.get("type") !== "personal" ||
        workspace.get("ownerUserId") !== candidate.userId ||
        user.get("registrationIntent") !== "personal"
      )
        throw new Error(`Candidate changed: ${candidate.membershipId}`);
      const now = FieldValue.serverTimestamp();
      tx.update(membershipRef, {
        personas: [...candidate.before, "parent"],
        personaMigrationId: runId,
        updatedAt: now,
      });
      tx.create(db.collection("migrationAudit").doc(), {
        migration: "personal_owner_parent_persona_v1",
        runId,
        membershipId: candidate.membershipId,
        userId: candidate.userId,
        workspaceId: candidate.workspaceId,
        before: { personas: candidate.before },
        after: { personas: [...candidate.before, "parent"] },
        rollback: { field: "personas", value: candidate.before },
        createdAt: now,
      });
    });
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      mode: execute ? "execute" : "dry-run",
      runId: execute ? runId : null,
      scanned: snapshot.size,
      beforeMissingParent: candidates.length,
      migrated: execute ? candidates.length : 0,
      alreadyCanonical,
      ambiguousCount: ambiguous.length,
      ambiguous,
      checkpoint: nextCheckpoint,
      resumable: snapshot.size === limit,
      confirmationDigest: digest,
    },
    null,
    2,
  )}\n`,
);
