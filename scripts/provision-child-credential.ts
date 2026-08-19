import { z } from "zod";
import { provisionChildCredential } from "../src/auth/services/child-credential-provisioning.js";

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const parsed = z
  .object({
    organizationId: z.string(),
    participantId: z.string(),
    familyAccessId: z.string(),
    actorUid: z.string(),
    handle: z.string(),
    familyCode: z.string().optional(),
    pin: z.string().optional(),
  })
  .safeParse({
    organizationId: value("--organization-id"),
    participantId: value("--participant-id"),
    familyAccessId: value("--family-access-id"),
    actorUid: value("--actor-uid"),
    handle: value("--handle"),
    familyCode: value("--family-code"),
    pin: value("--pin"),
  });
if (!parsed.success) {
  console.error(
    "Usage: ... --organization-id ID --participant-id ID --family-access-id ID --actor-uid UID --handle HANDLE [--family-code CODE] [--pin 6_DIGITS] --confirm",
  );
  process.exit(2);
}
if (!args.includes("--confirm"))
  throw new Error("Explicit --confirm is required.");
const { auth, db } = await import("../src/config/firebase.js");
const result = await provisionChildCredential(auth, db, parsed.data);
// This is the one intentional secret-delivery channel. Redirect it to an approved secrets handoff.
process.stdout.write(`${JSON.stringify(result)}\n`);
