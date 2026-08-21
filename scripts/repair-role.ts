import { z } from "zod";
import { repairPlatformRole } from "../src/auth/services/role-repair.js";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const parsed = z
  .object({
    uid: z.string().trim().min(1),
    role: z.literal("super_admin"),
  })
  .safeParse({ uid: value("--uid"), role: value("--restore-platform-role") });
const dryRun = args.includes("--dry-run");
const apply = args.includes("--apply");
if (!parsed.success || dryRun === apply) {
  console.error(
    "Usage: npm run auth:repair-role -- --uid <Firebase UID> --restore-platform-role super_admin (--dry-run|--apply)",
  );
  process.exit(2);
}
const { auth, db } = await import("../src/config/firebase.js");
const report = await repairPlatformRole(auth, db, {
  uid: parsed.data.uid,
  role: parsed.data.role,
  dryRun,
  actor: "auth-repair-role-cli",
});
console.log(
  JSON.stringify({
    ...report,
    nextStep: report.tokenRefreshRequired
      ? "User must sign out and sign in, or force-refresh the Firebase ID token."
      : "No token refresh is required.",
  }),
);
if (!report.eligible) {
  console.error(
    "Trusted prior evidence was not found; an authorized platform administrator must grant this role.",
  );
  process.exitCode = 3;
}
