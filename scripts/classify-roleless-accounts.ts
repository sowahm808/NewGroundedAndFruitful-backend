import { auth, db } from "../src/config/firebase.js";

const limit = Math.min(Number(process.env.CLASSIFICATION_LIMIT ?? 500), 5000);
const after = process.env.CLASSIFICATION_AFTER;
const ordered = db.collection("users").orderBy("__name__");
const query = (after ? ordered.startAfter(after) : ordered).limit(limit);
const users = await query.get();
const counts = {
  recoverable_self_registration: 0,
  pending_invitation: 0,
  awaiting_role_assignment: 0,
  partially_provisioned: 0,
  ambiguous_legacy: 0,
  inconsistent_cross_environment: 0,
};

for (const user of users.docs) {
  const data = user.data();
  const uid = user.id;
  const memberships = await db
    .collection("memberships")
    .where("userId", "==", uid)
    .get();
  const hasRole = memberships.docs.some(
    (doc) => doc.get("status") === "active" && roleCount(doc.data()) > 0,
  );
  if (hasRole) continue;
  let authExists = true;
  try {
    await auth.getUser(uid);
  } catch (error) {
    authExists =
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "auth/user-not-found";
  }
  if (!authExists || (typeof data.uid === "string" && data.uid !== uid)) {
    counts.inconsistent_cross_environment++;
    continue;
  }
  const email =
    typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const invitations = email
    ? await db
        .collection("adultInvitations")
        .where("email", "==", email)
        .where("status", "==", "pending")
        .get()
    : undefined;
  if (invitations && !invitations.empty) counts.pending_invitation++;
  else if (!memberships.empty) counts.awaiting_role_assignment++;
  else if (
    data.registrationIntent === "personal" ||
    data.registrationIntent === "organization"
  )
    counts.partially_provisioned++;
  else if (data.onboardingStatus === "registration_intent_required")
    counts.recoverable_self_registration++;
  else counts.ambiguous_legacy++;
}

process.stdout.write(
  `${JSON.stringify(
    {
      dryRun: true,
      scanned: users.size,
      counts,
      checkpoint: users.docs.at(-1)?.id ?? after ?? null,
    },
    null,
    2,
  )}\n`,
);

function roleCount(value: Record<string, unknown>): number {
  const roles = Array.isArray(value.roles)
    ? value.roles
    : typeof value.role === "string"
      ? [value.role]
      : [];
  return roles.length;
}
