import { FieldValue } from "firebase-admin/firestore";
import { db } from "../src/config/firebase.js";
import { normalizePersonas } from "../src/auth/capabilities.js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
if (apply === args.has("--dry-run"))
  throw new Error("Choose exactly one of --dry-run or --apply");

const runId = `role-model-v1-${new Date().toISOString()}`;
const snapshot = await db.collection("memberships").get();
const report = {
  runId,
  mode: apply ? "apply" : "dry-run",
  scanned: snapshot.size,
  changes: [] as Array<{
    membershipId: string;
    before: { workspaceRoles: string[]; personas: string[] };
    after: { workspaceRoles: string[]; personas: string[] };
  }>,
};

for (const membership of snapshot.docs) {
  const data = membership.data();
  const flattenedRoles = Array.isArray(data.roles)
    ? data.roles.filter((role): role is string => typeof role === "string")
    : [];
  const beforeWorkspaceRoles = Array.isArray(data.workspaceRoles)
    ? data.workspaceRoles.filter(
        (role): role is string => typeof role === "string",
      )
    : [];
  const beforePersonas = normalizePersonas(data.personas);
  const workspaceRoles = [
    ...new Set([
      ...beforeWorkspaceRoles,
      ...flattenedRoles.filter((role) =>
        ["owner", "admin", "super_admin"].includes(role),
      ),
    ]),
  ];
  const personas = [
    ...new Set([
      ...beforePersonas,
      ...normalizePersonas(flattenedRoles),
      ...(flattenedRoles.includes("admin") ? (["admin"] as const) : []),
    ]),
  ];
  if (
    JSON.stringify(workspaceRoles) === JSON.stringify(beforeWorkspaceRoles) &&
    JSON.stringify(personas) === JSON.stringify(beforePersonas)
  )
    continue;

  const change = {
    membershipId: membership.id,
    before: {
      workspaceRoles: beforeWorkspaceRoles,
      personas: beforePersonas,
    },
    after: { workspaceRoles, personas },
  };
  report.changes.push(change);
  if (apply) {
    const batch = db.batch();
    batch.update(membership.ref, {
      workspaceRoles,
      personas,
      roleModelMigrationRunId: runId,
      updatedAt: FieldValue.serverTimestamp(),
      version: FieldValue.increment(1),
    });
    batch.create(db.collection("auditLogs").doc(), {
      event: "membership.role_model_migrated",
      actorId: "system",
      subjectUid: data.userId,
      organizationId: data.organizationId,
      membershipId: membership.id,
      before: change.before,
      after: change.after,
      runId,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  }
}

console.log(JSON.stringify(report, null, 2));
