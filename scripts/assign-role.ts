import { z } from "zod";
import { canonicalRoles } from "../src/auth/roles.js";

const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const schema = z.object({
  uid: z.string().trim().min(1),
  role: z.enum(canonicalRoles),
  environment: z.enum(["development", "staging", "production"]),
  confirm: z.boolean(),
  replace: z.boolean(),
});
const parsed = schema.safeParse({
  uid: value("--uid"),
  role: value("--role"),
  environment: value("--environment"),
  confirm: args.includes("--confirm"),
  replace: args.includes("--replace"),
});
if (!parsed.success) {
  console.error(
    `Usage: npm run admin:assign-role -- --uid <uid> --role <${canonicalRoles.join("|")}> --environment <development|staging|production> [--replace] [--confirm]`,
  );
  process.exit(2);
}
if (parsed.data.environment === "production" && !parsed.data.confirm) {
  console.error("Production role assignment requires --confirm.");
  process.exit(2);
}
if (process.env.APP_ENV !== parsed.data.environment) {
  console.error("--environment must exactly match the configured APP_ENV.");
  process.exit(2);
}
if (
  parsed.data.environment === "production" &&
  (process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST)
) {
  console.error(
    "Production role assignment refuses Firebase emulator configuration.",
  );
  process.exit(2);
}

const [{ auth, db }, { assignRole }] = await Promise.all([
  import("../src/config/firebase.js"),
  import("../src/auth/services/role-assignment.js"),
]);
const result = await assignRole(auth, db, {
  uid: parsed.data.uid,
  role: parsed.data.role,
  replace: parsed.data.replace,
  updatedBy: "admin-role-cli",
  reason: "Explicit operational role provisioning",
  requestId: `cli-${String(Date.now())}`,
  initialBootstrap: parsed.data.role === "super_admin",
});
console.log(JSON.stringify({ uid: parsed.data.uid, ...result }));
console.log(
  "The user must refresh their Firebase ID token or sign out and back in.",
);
