import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../src/config/firebase.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const checkpointArg = process.argv.find((value) =>
  value.startsWith("--checkpoint="),
);
const checkpoint = checkpointArg?.slice("--checkpoint=".length);
const limit = Number(
  process.argv.find((value) => value.startsWith("--limit="))?.split("=")[1] ??
    200,
);
let query = db.collection("users").orderBy("__name__").limit(limit);
if (checkpoint) query = query.startAfter(checkpoint);
const users = await query.get();
const report = {
  dryRun,
  scanned: users.size,
  created: 0,
  existing: 0,
  ambiguous: [] as string[],
  checkpoint: users.docs.at(-1)?.id ?? checkpoint ?? null,
};
for (const user of users.docs) {
  const data = user.data();
  const memberships = await db
    .collection("memberships")
    .where("userId", "==", user.id)
    .get();
  const eligible =
    data.accountType === "individual" ||
    data.registrationIntent === "personal" ||
    memberships.empty;
  if (!eligible || data.status === "disabled") {
    report.ambiguous.push(user.id);
    continue;
  }
  const workspaceId = `personal-${createHash("sha256").update(user.id).digest("hex").slice(0, 24)}`;
  const workspace = db.doc(`workspaces/${workspaceId}`);
  if ((await workspace.get()).exists) {
    report.existing++;
    continue;
  }
  if (dryRun) {
    report.created++;
    continue;
  }
  await db.runTransaction(async (tx) => {
    if ((await tx.get(workspace)).exists) return;
    const now = FieldValue.serverTimestamp();
    tx.create(workspace, {
      type: "personal",
      name: `Personal — ${typeof data.displayName === "string" ? data.displayName : typeof data.email === "string" ? data.email : "My workspace"}`,
      ownerUserId: user.id,
      status: "active",
      timezone: data.timezone || "UTC",
      createdAt: now,
      updatedAt: now,
    });
    tx.create(db.doc(`memberships/${workspaceId}_${user.id}`), {
      userId: user.id,
      workspaceId,
      organizationId: workspaceId,
      roles: ["admin"],
      workspaceRoles: ["owner"],
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    tx.set(
      user.ref,
      { personalWorkspaceId: workspaceId, updatedAt: now },
      { merge: true },
    );
    tx.create(db.doc(`migrationRecords/personal-workspace-${user.id}`), {
      type: "personal_workspace",
      userId: user.id,
      workspaceId,
      status: "complete",
      createdAt: now,
    });
  });
  report.created++;
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
