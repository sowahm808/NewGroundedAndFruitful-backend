import { z } from "zod";
import { bootstrapOrganization } from "../src/admin/provisioning.js";

const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const parsed = z.object({ name: z.string(), timezone: z.string(), environment: z.enum(["development", "staging", "production"]) }).safeParse({ name: value("--name"), timezone: value("--timezone"), environment: value("--environment") });
if (!parsed.success) {
  console.error("Usage: npm run admin:bootstrap-organization -- --name <name> --timezone <IANA timezone> --environment <development|staging|production> [--dry-run] [--confirm]");
  process.exit(2);
}
if (process.env.APP_ENV !== parsed.data.environment) throw new Error("--environment must exactly match APP_ENV.");
if (parsed.data.environment === "production" && (process.env.FIRESTORE_EMULATOR_HOST || !args.includes("--confirm"))) throw new Error("Production requires --confirm and refuses emulator configuration.");
const { db } = await import("../src/config/firebase.js");
const report = await bootstrapOrganization(db, { ...parsed.data, confirmed: args.includes("--confirm"), dryRun: args.includes("--dry-run"), actor: "admin-bootstrap-cli" });
console.log(JSON.stringify(report));
