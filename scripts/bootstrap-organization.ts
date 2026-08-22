import { z } from "zod";
import { randomUUID } from "node:crypto";
import { bootstrapLegacyAdministrator } from "../src/admin/provisioning.js";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const parsed = z
  .object({
    uid: z.string(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    environment: z.enum(["development", "staging", "production"]),
  })
  .safeParse({
    uid: value("--uid"),
    name: value("--name"),
    slug: value("--slug"),
    timezone: value("--timezone"),
    environment: value("--environment"),
  });
if (!parsed.success) {
  console.error(
    "Usage: npm run admin:bootstrap-organization -- --uid <Firebase UID> --name <name> --slug <slug> --timezone <IANA timezone> --environment <development|staging|production> (--dry-run|--confirm)",
  );
  process.exit(2);
}
if (process.env.APP_ENV !== parsed.data.environment)
  throw new Error("--environment must exactly match APP_ENV.");
if (args.includes("--dry-run") === args.includes("--confirm"))
  throw new Error("Choose exactly one of --dry-run or --confirm.");
if (
  parsed.data.environment === "production" &&
  (process.env.FIRESTORE_EMULATOR_HOST || !args.includes("--confirm"))
)
  throw new Error(
    "Production requires --confirm and refuses emulator configuration.",
  );
const { auth, db } = await import("../src/config/firebase.js");
const report = await bootstrapLegacyAdministrator(auth, db, {
  uid: parsed.data.uid,
  name: parsed.data.name,
  slug: parsed.data.slug,
  timezone: parsed.data.timezone,
  dryRun: args.includes("--dry-run"),
  actor: "admin-bootstrap-cli",
  requestId: randomUUID(),
});
console.log(JSON.stringify(report));
