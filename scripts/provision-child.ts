import { z } from "zod";
import { provisionChild } from "../src/admin/provisioning.js";

const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const parsed = z.object({ uid: z.string(), organizationId: z.string(), displayName: z.string(), environment: z.enum(["development", "staging", "production"]), parentUid: z.string().optional() }).safeParse({ uid: value("--uid"), organizationId: value("--organization-id"), displayName: value("--display-name"), environment: value("--environment"), parentUid: value("--parent-uid") });
if (!parsed.success) {
  console.error("Usage: npm run admin:provision-child -- --uid <uid> --organization-id <id> --display-name <name> --environment <development|staging|production> [--parent-uid <uid>] [--dry-run] [--confirm]");
  process.exit(2);
}
if (process.env.APP_ENV !== parsed.data.environment) throw new Error("--environment must exactly match APP_ENV.");
if (parsed.data.environment === "production" && (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST || !args.includes("--confirm"))) throw new Error("Production requires --confirm and refuses emulator configuration.");
const { auth, db } = await import("../src/config/firebase.js");
const report = await provisionChild(auth, db, {
  uid: parsed.data.uid, organizationId: parsed.data.organizationId,
  displayName: parsed.data.displayName, environment: parsed.data.environment,
  ...(parsed.data.parentUid ? { parentUid: parsed.data.parentUid } : {}),
  confirmed: args.includes("--confirm"), dryRun: args.includes("--dry-run"),
  actor: "admin-provision-child-cli",
});
console.log(JSON.stringify(report));
if (report.claims === "retry_required") console.log("Claim synchronization requires a safe retry; Firestore provisioning is preserved.");
