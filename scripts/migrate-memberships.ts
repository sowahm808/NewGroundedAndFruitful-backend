import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { db } from "../src/config/firebase.js";
import { canonicalRoles, type Role } from "../src/auth/roles.js";

const args = new Set(process.argv.slice(2));
const value = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const environment = value("--environment");
const verify = args.has("--verify");
const dryRun = args.has("--dry-run");
const confirm = args.has("--confirm");
const rollback = args.has("--rollback");
const batchSize = Number(value("--batch-size") ?? "200");
if (!environment || !["development", "staging", "production"].includes(environment))
  throw new Error("--environment must be development, staging, or production");
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 400)
  throw new Error("--batch-size must be between 1 and 400");
if (!verify && !dryRun && !confirm && !rollback)
  throw new Error("Choose --dry-run, --confirm, or --rollback");
if ([dryRun, confirm, rollback].filter(Boolean).length > 1)
  throw new Error("Migration modes are mutually exclusive");

const runId = `legacy-memberships-v1-${environment}`;
const checkpoint = db.doc(`systemSettings/migration_${runId}`);
const canonical = new Set<string>(canonicalRoles);
const summary = { scanned: 0, applicable: 0, existing: 0, created: 0, ambiguous: 0, invalid: 0 };
let cursor: string | undefined = confirm ? (await checkpoint.get()).get("lastUserId") as string | undefined : undefined;

let hasMore = true;
while (hasMore) {
  let query = db.collection("users").orderBy(FieldPath.documentId()).limit(batchSize);
  if (cursor) query = query.startAfter(cursor);
  const users = await query.get();
  if (users.empty) { hasMore = false; break; }
  for (const user of users.docs) {
    summary.scanned++;
    const data = user.data();
    if (data.status === "disabled") continue;
    const raw = Array.isArray(data.roles) ? data.roles : data.role == null ? [] : [data.role];
    const roles = [...new Set(raw.filter((role): role is Role => typeof role === "string" && canonical.has(role)))];
    if (raw.length !== roles.length) summary.invalid++;
    if (roles.length === 0) continue;
    summary.applicable++;
    const existing = await db.collection("memberships").where("userId", "==", user.id).limit(1).get();
    if (!existing.empty) { summary.existing++; continue; }
    const ids = Array.isArray(data.organizationIds)
      ? data.organizationIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      : typeof data.organizationId === "string" ? [data.organizationId] : [];
    const organizations = [...new Set(ids)];
    if (organizations.length !== 1) { summary.ambiguous++; continue; }
    if (confirm) {
      const membership = db.doc(`memberships/${organizations[0]!}_${user.id}`);
      const audit = db.collection("auditLogs").doc();
      const batch = db.batch();
      batch.create(membership, { id: membership.id, userId: user.id, organizationId: organizations[0], roles, status: "active", version: 1, migrationRunId: runId, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      batch.create(audit, { event: "membership.migration.created", actorUid: "system", subjectUid: user.id, organizationId: organizations[0], migrationRunId: runId, createdAt: FieldValue.serverTimestamp() });
      await batch.commit();
      summary.created++;
    }
  }
  cursor = users.docs.at(-1)!.id;
  if (confirm) await checkpoint.set({ lastUserId: cursor, summary, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  if (users.size < batchSize) hasMore = false;
}

if (rollback) {
  const created = await db.collection("memberships").where("migrationRunId", "==", runId).where("status", "==", "active").get();
  for (let offset = 0; offset < created.size; offset += batchSize) {
    const batch = db.batch();
    for (const doc of created.docs.slice(offset, offset + batchSize)) batch.update(doc.ref, { status: "revoked", rollbackRunId: runId, updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1) });
    await batch.commit();
  }
  console.log(JSON.stringify({ mode: "rollback", revoked: created.size, runId }));
} else {
  console.log(JSON.stringify({ mode: verify ? "verify" : dryRun ? "dry-run" : "confirmed", runId, summary }));
  if (verify && (summary.ambiguous > 0 || summary.invalid > 0 || summary.applicable !== summary.existing)) process.exitCode = 2;
}
