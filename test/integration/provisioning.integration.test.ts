import { deleteApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapOrganization, provisionChild } from "../../src/admin/provisioning.js";
import "../../src/config/firebase.js";

const db = getFirestore();
const auth = getAuth();
const uid = "provisioning-child";
const bootstrap = { name: "Integration Organization", timezone: "America/Chicago", environment: "development" as const, confirmed: false, actor: "integration-test" };

beforeEach(async () => {
  for (const collection of ["organizations", "users", "memberships", "participants", "parentChildLinks", "auditLogs"]) {
    const snapshot = await db.collection(collection).get();
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  await auth.deleteUser(uid).catch(() => undefined);
});
afterAll(async () => Promise.all(getApps().map((app) => deleteApp(app))));

describe("administrative provisioning against Firebase emulators", () => {
  it("bootstraps once, returns an exact retry, audits, and rejects ambiguity", async () => {
    const created = await bootstrapOrganization(db, bootstrap);
    expect(created.outcome).toBe("created");
    await expect(bootstrapOrganization(db, bootstrap)).resolves.toMatchObject({ organizationId: created.organizationId, outcome: "existing" });
    expect((await db.collection("auditLogs").where("event", "==", "ORGANIZATION_BOOTSTRAPPED").get()).size).toBe(1);
    await db.doc("organizations/duplicate").set({ name: bootstrap.name, timezone: bootstrap.timezone, status: "active" });
    await expect(bootstrapOrganization(db, bootstrap)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("provisions idempotently and repairs missing membership or participant", async () => {
    const org = await bootstrapOrganization(db, bootstrap);
    await auth.createUser({ uid, displayName: "Integration Child" });
    const input = { uid, organizationId: org.organizationId, displayName: "Integration Child", environment: "development" as const, confirmed: false, actor: "integration-test" };
    const first = await provisionChild(auth, db, input);
    expect(first.changes).toEqual(expect.arrayContaining(["user_created", "membership_created", "participant_created"]));
    await expect(provisionChild(auth, db, input)).resolves.toMatchObject({ outcome: "unchanged", claims: "synchronized" });
    expect((await db.collection("memberships").where("userId", "==", uid).get()).size).toBe(1);
    expect((await db.collection("participants").where("firebaseUid", "==", uid).get()).size).toBe(1);
    await db.doc(`participants/${first.participantId}`).delete();
    await expect(provisionChild(auth, db, input)).resolves.toMatchObject({ changes: ["participant_created"] });
    await db.doc(`memberships/${first.membershipId}`).delete();
    await expect(provisionChild(auth, db, input)).resolves.toMatchObject({ changes: ["membership_created"] });
  });

  it("rejects duplicate, cross-organization, suspended, and inactive records", async () => {
    const org = await bootstrapOrganization(db, bootstrap);
    await auth.createUser({ uid });
    const input = { uid, organizationId: org.organizationId, displayName: "Child", environment: "development" as const, confirmed: false, actor: "test" };
    await db.doc("memberships/a").set({ userId: uid, organizationId: org.organizationId, roles: ["child"], status: "active" });
    await db.doc("memberships/b").set({ userId: uid, organizationId: org.organizationId, roles: ["child"], status: "active" });
    await expect(provisionChild(auth, db, input)).rejects.toMatchObject({ code: "CONFLICT" });
    await db.doc("memberships/b").delete();
    await db.doc("memberships/a").update({ status: "suspended" });
    await expect(provisionChild(auth, db, input)).rejects.toMatchObject({ code: "CONFLICT" });
    await db.doc("memberships/a").update({ status: "active", organizationId: "other" });
    await expect(provisionChild(auth, db, input)).rejects.toMatchObject({ code: "CONFLICT" });
    await db.doc("memberships/a").update({ organizationId: org.organizationId });
    await db.doc("participants/a").set({ firebaseUid: uid, organizationId: org.organizationId, status: "inactive" });
    await expect(provisionChild(auth, db, input)).rejects.toMatchObject({ code: "CONFLICT" });
    await db.doc("participants/a").update({ status: "active" });
    await db.doc("participants/b").set({ firebaseUid: uid, organizationId: org.organizationId, status: "active" });
    await expect(provisionChild(auth, db, input)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("dry runs without records and repairs a deterministic participant missing its UID", async () => {
    const org = await bootstrapOrganization(db, bootstrap);
    await auth.createUser({ uid });
    const input = { uid, organizationId: org.organizationId, displayName: "Child", environment: "development" as const, confirmed: false, actor: "test" };
    const dry = await provisionChild(auth, db, { ...input, dryRun: true });
    expect(dry.outcome).toBe("dry_run");
    expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
    await db.doc(`participants/${dry.participantId}`).set({ organizationId: org.organizationId, displayName: "Child", status: "active" });
    await expect(provisionChild(auth, db, input)).resolves.toMatchObject({ changes: expect.arrayContaining(["participant_uid_repaired"]) });
  });
});
