import { z } from "zod";
import {
  credentialLookupDigest,
  normalizeCredentialPart,
} from "../src/auth/repositories/child-credentials.js";

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const options = z
  .object({
    batchSize: z.coerce.number().int().min(1).max(200).default(100),
    checkpoint: z.string().optional(),
  })
  .parse({
    batchSize: value("--batch-size"),
    checkpoint: value("--checkpoint"),
  });
const dryRun = args.includes("--dry-run"),
  verify = args.includes("--verify");
const { db } = await import("../src/config/firebase.js");
let query = db
  .collection("childCredentials")
  .orderBy("__name__")
  .limit(options.batchSize);
if (options.checkpoint) query = query.startAfter(options.checkpoint);
const snapshot = await query.get();
const report = {
  dryRun,
  scanned: snapshot.size,
  migrated: 0,
  verified: 0,
  collisions: [] as string[],
  invalid: [] as string[],
  checkpoint: snapshot.docs.at(-1)?.id ?? options.checkpoint ?? null,
};
for (const legacy of snapshot.docs) {
  if (/^[a-f0-9]{64}$/.test(legacy.id)) continue;
  const separator = legacy.id.indexOf("_");
  if (separator < 1 || separator === legacy.id.length - 1) {
    report.invalid.push(legacy.id);
    continue;
  }
  const familyCode = normalizeCredentialPart(legacy.id.slice(0, separator)),
    handle = normalizeCredentialPart(legacy.id.slice(separator + 1));
  const destination = db.doc(
      `childCredentials/${credentialLookupDigest(familyCode, handle)}`,
    ),
    existing = await destination.get();
  if (
    existing.exists &&
    existing.get("migration.legacyDocumentId") !== legacy.id
  ) {
    report.collisions.push(legacy.id);
    continue;
  }
  if (verify) {
    if (
      existing.exists &&
      existing.get("migration.legacyDocumentId") === legacy.id
    )
      report.verified++;
    continue;
  }
  if (!dryRun) {
    const { passwordHash, ...legacyData } = legacy.data();
    await destination.set(
      {
        ...legacyData,
        pinHash: legacy.get("pinHash") ?? passwordHash,
        normalizedHandle: handle,
        migration: {
          legacyDocumentId: legacy.id,
          migratedAt: new Date().toISOString(),
          rollback: { action: "delete_hmac_copy_only", sourcePreserved: true },
        },
      },
      { merge: true },
    );
  }
  report.migrated++;
}
process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.collisions.length || report.invalid.length) process.exitCode = 3;
