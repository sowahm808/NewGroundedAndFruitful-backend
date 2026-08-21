import type { Server } from "node:http";
import { deleteApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import "../../src/config/firebase.js";

const auth = getAuth();
const db = getFirestore();
let server: Server;
let base: string;

async function createIdentity(email: string) {
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  const response = await fetch(
    `http://${emulator}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=integration-test`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "integration-password",
        returnSecureToken: true,
      }),
    },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { localId: string; idToken: string };
}

async function selectIntent(token?: string) {
  return fetch(`${base}/api/v1/auth/registration-intent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ intent: "organization" }),
  });
}

beforeAll(() => {
  server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind");
  base = `http://127.0.0.1:${String(address.port)}`;
});

beforeEach(async () => {
  for (const collection of [
    "users",
    "memberships",
    "organizations",
    "workspaces",
    "organizationSlugs",
    "onboardingBootstraps",
    "auditLogs",
  ]) {
    const snapshot = await db.collection(collection).get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
  const users = await auth.listUsers();
  await Promise.all(users.users.map((user) => auth.deleteUser(user.uid)));
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await Promise.all(getApps().map((firebaseApp) => deleteApp(firebaseApp)));
});

describe("registration intent HTTP policy", () => {
  it("atomically bootstraps a roleless organization registrant and returns an exact retry", async () => {
    const identity = await createIdentity("bootstrap@example.test");
    expect((await selectIntent(identity.idToken)).status).toBe(201);
    const payload = {
      name: "Makrozoia Solutions",
      slug: "makrozoia-solutions",
      timezone: "America/Chicago",
    };
    const bootstrap = () =>
      fetch(`${base}/api/v1/onboarding/organization`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${identity.idToken}`,
          "content-type": "application/json",
          "idempotency-key": "registration-submit-1",
        },
        body: JSON.stringify(payload),
      });
    const first = await bootstrap();
    expect(first.status).toBe(201);
    const body = (await first.json()) as {
      data: { workspace: { id: string } };
    };
    expect(body).toMatchObject({
      data: {
        workspace: { type: "organization", ...payload, status: "active" },
        membership: { roles: ["owner", "admin"], status: "active" },
        onboardingStatus: "complete",
        nextStep: "dashboard",
        tokenRefreshRequired: true,
      },
    });
    expect((await bootstrap()).status).toBe(201);
    expect(
      (await Promise.all([bootstrap(), bootstrap()])).map(
        (response) => response.status,
      ),
    ).toEqual([201, 201]);
    expect((await db.collection("organizations").get()).size).toBe(1);
    expect((await db.collection("memberships").get()).size).toBe(1);
    expect((await db.collection("auditLogs").get()).size).toBe(4);
    expect(
      (await db.doc(`users/${identity.localId}`).get()).data(),
    ).toMatchObject({
      onboardingStatus: "complete",
      activeWorkspaceId: body.data.workspace.id,
      roles: [],
    });
  });

  it("rejects ineligible intent and authority fields without partial writes", async () => {
    const identity = await createIdentity("personal-bootstrap@example.test");
    await db.doc(`users/${identity.localId}`).set({
      uid: identity.localId,
      email: "personal-bootstrap@example.test",
      displayName: "Personal",
      roles: [],
      status: "active",
      registrationIntent: "personal",
      onboardingStatus: "personal_workspace_required",
    });
    const response = await fetch(`${base}/api/v1/onboarding/organization`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${identity.idToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Escalation",
        slug: "escalation",
        timezone: "UTC",
        uid: "victim",
        roles: ["super_admin"],
        workspaceId: "chosen",
      }),
    });
    expect(response.status).toBe(422);
    expect((await db.collection("organizations").get()).empty).toBe(true);
    expect((await db.collection("memberships").get()).empty).toBe(true);
  });
  it("allows an idempotent organization intent for a roleless Firebase user", async () => {
    const identity = await createIdentity("roleless@example.test");
    const first = await selectIntent(identity.idToken);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      data: {
        registrationIntent: "organization",
        onboardingStatus: "organization_setup_required",
      },
    });
    const retry = await selectIntent(identity.idToken);
    expect(retry.status).toBe(201);
    const profile = await db.doc(`users/${identity.localId}`).get();
    expect(profile.data()).toMatchObject({
      roles: [],
      onboardingStatus: "organization_setup_required",
    });
    expect(
      (
        await db
          .collection("memberships")
          .where("userId", "==", identity.localId)
          .get()
      ).empty,
    ).toBe(true);
  });

  it("is not intercepted by parent guards and returns 401 without a token", async () => {
    const response = await selectIntent();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  it("returns ACCOUNT_DISABLED for a disabled Firebase identity", async () => {
    const identity = await createIdentity("disabled@example.test");
    await auth.updateUser(identity.localId, { disabled: true });
    const response = await selectIntent(identity.idToken);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "ACCOUNT_DISABLED" },
    });
  });
});
