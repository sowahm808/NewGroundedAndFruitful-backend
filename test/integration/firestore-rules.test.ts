import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let env: RulesTestEnvironment;
const projectId = "demo-grounded-fruitful-rules";
const authed = (uid: string, roles?: unknown) =>
  env
    .authenticatedContext(uid, roles === undefined ? {} : { roles })
    .firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});
beforeEach(async () => env.clearFirestore());
afterAll(async () => env.cleanup());

async function seed() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users/child-auth"), {
        uid: "child-auth",
        status: "active",
        roles: ["child"],
      }),
      setDoc(doc(db, "users/other"), {
        uid: "other",
        status: "active",
        roles: [],
      }),
      setDoc(doc(db, "participants/participant-1"), {
        firebaseUid: "child-auth",
        organizationId: "org-1",
        status: "active",
        points: 10,
      }),
      ...([ ["child-auth", "child"], ["parent-1", "parent"], ["mentor-1", "mentor"], ["observer-1", "observer"] ] as const).map(([uid, role]) =>
        setDoc(doc(db, `memberships/org-1_${uid}`), {
          userId: uid, organizationId: "org-1", roles: [role], status: "active",
        }),
      ),
      setDoc(doc(db, "memberships/org-1_suspended"), {
        userId: "suspended", organizationId: "org-1", roles: ["child"], status: "suspended",
      }),
      setDoc(doc(db, "parentChildLinks/parent-1_participant-1"), {
        parentUid: "parent-1",
        participantId: "participant-1",
        organizationId: "org-1",
        status: "active",
        revokedAt: null,
      }),
      setDoc(doc(db, "teams/team-1"), {
        organizationId: "org-1",
        roster: ["participant-1"],
      }),
      setDoc(doc(db, "teams/team-2"), { organizationId: "org-2" }),
      setDoc(doc(db, "mentorAssignments/mentor-1_team-1"), {
        mentorUid: "mentor-1", teamId: "team-1", organizationId: "org-1",
        status: "active", revokedAt: null,
      }),
      setDoc(doc(db, "observerGrants/observer-1_participant-1"), {
        observerUid: "observer-1", participantId: "participant-1",
        organizationId: "org-1", status: "active", revokedAt: null,
      }),
      setDoc(doc(db, "teamMembers/team-1_mentor_mentor-1"), {
        userId: "mentor-1",
        teamId: "team-1",
        organizationId: "org-1",
        role: "mentor",
        status: "active",
      }),
      setDoc(doc(db, "memberships/org-1_admin-1"), {
        userId: "admin-1",
        organizationId: "org-1",
        roles: ["admin"],
        status: "active",
      }),
    ]);
  });
}

describe("production Firestore rules", () => {
  it("denies anonymous reads", async () => {
    await seed();
    await assertFails(
      getDoc(doc(env.unauthenticatedContext().firestore(), "users/child-auth")),
    );
  });
  it("allows user self-read but denies another user and every client user write", async () => {
    await seed();
    const db = authed("child-auth", ["child"]);
    await assertSucceeds(getDoc(doc(db, "users/child-auth")));
    await assertFails(getDoc(doc(db, "users/other")));
    await assertFails(
      setDoc(doc(db, "users/child-auth"), {
        roles: ["super_admin"],
        status: "active",
      }),
    );
  });
  it("allows self access to the relationship-safe participant profile", async () => {
    await seed();
    await assertSucceeds(
      getDoc(
        doc(authed("child-auth", ["child"]), "participants/participant-1"),
      ),
    );
    await assertFails(
      getDoc(
        doc(authed("participant-1", ["child"]), "participants/participant-1"),
      ),
    );
  });
  it("allows linked-parent access and denies it after revocation", async () => {
    await seed();
    const ref = doc(
      authed("parent-1", ["parent"]),
      "participants/participant-1",
    );
    await assertSucceeds(getDoc(ref));
    await env.withSecurityRulesDisabled(async (c) =>
      setDoc(doc(c.firestore(), "parentChildLinks/parent-1_participant-1"), {
        parentUid: "parent-1",
        participantId: "participant-1",
        organizationId: "org-1",
        status: "revoked",
        revokedAt: new Date(),
      }),
    );
    await assertFails(getDoc(ref));
  });
  it("denies missing and cross-organization parent links", async () => {
    await seed();
    await assertFails(
      getDoc(
        doc(authed("missing-parent", ["parent"]), "participants/participant-1"),
      ),
    );
    await env.withSecurityRulesDisabled(async (c) =>
      setDoc(doc(c.firestore(), "parentChildLinks/parent-1_participant-1"), {
        parentUid: "parent-1",
        participantId: "participant-1",
        organizationId: "org-2",
        status: "active",
        revokedAt: null,
      }),
    );
    await assertFails(
      getDoc(doc(authed("parent-1", ["parent"]), "participants/participant-1")),
    );
  });
  it("allows an active mentor assignment without granting other teams", async () => {
    await seed();
    const db = authed("mentor-1", ["mentor"]);
    await assertSucceeds(getDoc(doc(db, "teams/team-1")));
    await assertFails(getDoc(doc(db, "teams/team-2")));
    await assertFails(
      getDoc(doc(authed("mentor-2", ["mentor"]), "teams/team-1")),
    );
  });
  it("allows an active observer grant and denies unrelated observers", async () => {
    await seed();
    await assertSucceeds(getDoc(doc(authed("observer-1"), "participants/participant-1")));
    await assertFails(getDoc(doc(authed("observer-2"), "participants/participant-1")));
  });
  it("denies a suspended membership even when the user owns the participant", async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (c) =>
      setDoc(doc(c.firestore(), "participants/participant-1"), {
        firebaseUid: "suspended", organizationId: "org-1", status: "active",
      }),
    );
    await assertFails(getDoc(doc(authed("suspended"), "participants/participant-1")));
  });
  it("uses memberships for tenant roles and rejects claims without scope", async () => {
    await seed();
    await assertFails(getDoc(doc(authed("ordinary", []), "teams/team-1")));
    await assertSucceeds(getDoc(doc(authed("mentor-1"), "teams/team-1")));
    await assertSucceeds(
      getDoc(doc(authed("mentor-1", "mentor"), "teams/team-1")),
    );
    await assertSucceeds(
      getDoc(doc(authed("mentor-1", ["owner"]), "teams/team-1")),
    );
    await assertFails(getDoc(doc(authed("ordinary", ["admin"]), "teams/team-1")));
  });
  it("scopes tenant administrators and permits only the explicit platform operator globally", async () => {
    await seed();
    const admin = authed("admin-1", ["admin"]);
    await assertSucceeds(getDoc(doc(admin, "teams/team-1")));
    await assertFails(getDoc(doc(admin, "teams/team-2")));
    await assertFails(getDoc(doc(authed("root", ["super_admin"]), "teams/team-2")));
    await assertSucceeds(getDoc(doc(authed("root", ["platform_super_admin"]), "teams/team-2")));
  });
  it("denies direct memberships, points, audits, team writes, and nested paths", async () => {
    await seed();
    const db = authed("root", ["super_admin"]);
    await assertFails(
      setDoc(doc(db, "memberships/org-1_root"), { roles: ["super_admin"] }),
    );
    await assertFails(setDoc(doc(db, "pointLedger/direct"), { points: 999 }));
    await assertFails(setDoc(doc(db, "auditLogs/direct"), { event: "fake" }));
    await assertFails(setDoc(doc(db, "childCredentials/direct"), { pinHash: "fake" }));
    await assertFails(
      setDoc(doc(db, "teams/team-1"), { organizationId: "org-1" }),
    );
    await assertFails(getDoc(doc(db, "teams/team-1/private/record")));
    await assertFails(getDoc(doc(db, "unknown/x")));
    for (const collection of ["dailyCheckins", "characterCycles", "characterAssessments", "bibleActivities", "bibleActivityResponses", "readingAssignments", "readingResponses", "projects", "projectMilestones", "projectUpdates", "teamMembers", "pointRules", "supportCategories"]) {
      await assertFails(getDoc(doc(db, `${collection}/private`)));
      await assertFails(setDoc(doc(db, `${collection}/private`), { organizationId: "org-1" }));
    }
  });
});
