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

async function identity(email: string) {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST!}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=integration-test`,
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

async function membership(
  uid: string,
  workspaceId: string,
  personas: string[],
) {
  await db.doc(`memberships/${uid}_${workspaceId}`).set({
    userId: uid,
    organizationId: workspaceId,
    workspaceId,
    roles: [],
    personas,
    status: "active",
    version: 1,
  });
  await db
    .doc(`users/${uid}`)
    .set({ status: "active", activeWorkspaceId: workspaceId });
}

function parentGet(token: string, path = "children", workspaceId?: string) {
  return fetch(`${base}/api/v1/parent/${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
    },
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
    "participants",
    "parentChildLinks",
    "quarters",
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

describe("parent relationship HTTP policy", () => {
  it.each(["personal-family", "organization-family"])(
    "returns an empty 200 for a Parent in the %s workspace",
    async (workspaceId) => {
      const parent = await identity(`${workspaceId}@example.test`);
      await membership(parent.localId, workspaceId, ["parent"]);
      const response = await parentGet(parent.idToken, "children", workspaceId);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      expect(await response.json()).toEqual({
        data: [],
        meta: { nextCursor: null },
      });
    },
  );

  it("returns 403 when the active workspace lacks Parent capability", async () => {
    const child = await identity("not-a-parent@example.test");
    await membership(child.localId, "organization-family", ["child"]);
    const response = await parentGet(child.idToken);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "FORBIDDEN", requestId: expect.any(String) },
    });
  });

  it("returns scoped 404 for an unlinked child detail", async () => {
    const parent = await identity("unlinked-parent@example.test");
    await membership(parent.localId, "organization-family", ["parent"]);
    await db
      .doc("participants/unlinked-child")
      .set({
        organizationId: "organization-family",
        approvedDisplayName: "Unlinked Child",
        status: "active",
      });
    const response = await parentGet(parent.idToken, "children/unlinked-child");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND", requestId: expect.any(String) },
    });
  });

  it("returns only active linked children in the selected workspace and only public fields", async () => {
    const parent = await identity("scoped-parent@example.test");
    await membership(parent.localId, "workspace-a", ["parent"]);
    await membership(parent.localId, "workspace-b", ["parent"]);
    const participants = [
      ["included", "workspace-a", "active"],
      ["inactive-child", "workspace-a", "inactive"],
      ["inactive-link", "workspace-a", "active"],
      ["other-tenant", "workspace-b", "active"],
    ] as const;
    await Promise.all(
      participants.map(([id, organizationId, status]) =>
        db
          .doc(`participants/${id}`)
          .set({
            organizationId,
            approvedDisplayName: id,
            status,
            birthDate: "2014-01-01",
            email: `${id}@private.test`,
            firebaseUid: `private-${id}`,
            medicalNotes: "private",
          }),
      ),
    );
    await Promise.all(
      participants.map(([id, organizationId]) =>
        db
          .doc(`parentChildLinks/${parent.localId}_${id}`)
          .set({
            parentUid: parent.localId,
            participantId: id,
            organizationId,
            status: id === "inactive-link" ? "inactive" : "active",
          }),
      ),
    );
    const response = await parentGet(parent.idToken, "children", "workspace-a");
    const body = (await response.json()) as { data: Record<string, unknown>[] };
    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: "included", status: "active" });
    for (const privateField of [
      "birthDate",
      "email",
      "firebaseUid",
      "medicalNotes",
    ])
      expect(body.data[0]).not.toHaveProperty(privateField);
  });
});
