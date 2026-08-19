import { db, auth } from "../src/config/firebase.js";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Seed only runs with Auth and Firestore emulators.");
const fixtures = [
  [
    "quarters/q-active",
    {
      name: "Quarter 1",
      durationWeeks: 12,
      teamPointTarget: 5000,
      targetWeek: 8,
      status: "active",
    },
  ],
  ["teams/team-a", { name: "Team A", archived: false }],
  ["teams/team-b", { name: "Team B", archived: false }],
  ["books/book-1", { title: "Fixture Book", quarterId: "q-active" }],
  ["projects/project-1", { participantId: "child-1", state: "idea" }],
  ["surveys/survey-1", { type: "pre_quarter", version: 1 }],
] as const;
await Promise.all(fixtures.map(([path, data]) => db.doc(path).set(data)));
for (const [uid, role] of [
  ["parent-1", "parent"],
  ["child-1", "child"],
  ["child-2", "child"],
  ["mentor-1", "mentor"],
  ["admin-1", "admin"],
] as const) {
  await auth
    .createUser({ uid, displayName: `Fixture ${role}` })
    .catch(() => undefined);
  await auth.setCustomUserClaims(uid, { roles: [role], role });
  await db
    .doc(`users/${uid}`)
    .set({ uid, displayName: `Fixture ${role}`, roles: [], status: "active" });
  await db
    .doc(`memberships/org-fixture_${uid}`)
    .set({
      userId: uid,
      organizationId: "org-fixture",
      roles: [role],
      status: "active",
    });
}
console.log("Deterministic emulator fixtures seeded.");
