import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { RegistrationIntentService } from "../src/auth/workspaces.js";

class MemoryFirestore {
  readonly records = new Map<string, Record<string, unknown>>();
  private sequence = 0;
  private queue: Promise<unknown> = Promise.resolve();

  doc(path: string) {
    return { path };
  }

  collection(path: string) {
    return {
      doc: () => ({ path: `${path}/auto-${String(++this.sequence)}` }),
      where: (_field: string, _operator: string, value: string) => ({
        collection: path,
        value,
      }),
    };
  }

  runTransaction<T>(work: (tx: MemoryTransaction) => Promise<T>): Promise<T> {
    const result = this.queue.then(() => work(new MemoryTransaction(this)));
    this.queue = result.catch(() => undefined);
    return result;
  }
}

class MemoryTransaction {
  constructor(private readonly db: MemoryFirestore) {}

  get(ref: { path?: string; collection?: string; value?: string }) {
    if (ref.collection) {
      const collection = ref.collection;
      const docs = [...this.db.records.entries()]
        .filter(
          ([path, value]) =>
            path.startsWith(`${collection}/`) && value.userId === ref.value,
        )
        .map(([path, value]) => snapshot(path, value));
      return Promise.resolve({ docs, empty: docs.length === 0 });
    }
    return Promise.resolve(snapshot(ref.path!, this.db.records.get(ref.path!)));
  }

  set(
    ref: { path: string },
    value: Record<string, unknown>,
    options?: { merge?: boolean },
  ) {
    const current = this.db.records.get(ref.path) ?? {};
    this.db.records.set(
      ref.path,
      options?.merge ? { ...current, ...value } : value,
    );
  }

  create(ref: { path: string }, value: Record<string, unknown>) {
    if (this.db.records.has(ref.path)) throw new Error("already exists");
    this.db.records.set(ref.path, value);
  }
}

function snapshot(path: string, value?: Record<string, unknown>) {
  return {
    id: path.split("/").at(-1),
    exists: Boolean(value),
    empty: !value,
    get: (field: string) => value?.[field],
    data: () => value,
  };
}

const serviceFor = () => {
  const memory = new MemoryFirestore();
  return {
    memory,
    service: new RegistrationIntentService(memory as unknown as Firestore),
  };
};
const identity = { email: "new@example.com", displayName: "New User" };

describe("registration intent state machine", () => {
  it.each([
    ["personal", "personal_workspace_required", "personal_workspace_setup"],
    ["organization", "organization_setup_required", "organization_setup"],
  ] as const)(
    "allows a roleless user to select %s",
    async (intent, status, nextStep) => {
      const { memory, service } = serviceFor();
      await expect(
        service.select("verified-uid", identity, intent, "request-1"),
      ).resolves.toMatchObject({
        registrationIntent: intent,
        onboardingStatus: status,
        nextStep,
        version: 1,
      });
      expect(memory.records.get("users/verified-uid")).toMatchObject({
        uid: "verified-uid",
        roles: [],
        registrationIntent: intent,
        onboardingStatus: status,
      });
      expect(
        [...memory.records.keys()].some((key) =>
          key.startsWith("memberships/"),
        ),
      ).toBe(false);
    },
  );

  it("makes exact and concurrent identical retries one logical transition", async () => {
    const { memory, service } = serviceFor();
    const results = await Promise.all([
      service.select("uid", identity, "organization", "one"),
      service.select("uid", identity, "organization", "two"),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].version).toBe(1);
    expect(
      [...memory.records.keys()].filter((key) => key.startsWith("auditLogs/")),
    ).toHaveLength(1);
  });

  it("permits a pre-bootstrap change without deleting data", async () => {
    const { memory, service } = serviceFor();
    await service.select("uid", identity, "personal", "one");
    await expect(
      service.select("uid", identity, "organization", "two"),
    ).resolves.toMatchObject({
      registrationIntent: "organization",
      version: 2,
    });
    expect(memory.records.get("users/uid")?.roles).toEqual([]);
  });

  it("rejects an incompatible post-bootstrap change", async () => {
    const { memory, service } = serviceFor();
    await service.select("uid", identity, "personal", "one");
    memory.records.set("memberships/workspace_uid", {
      userId: "uid",
      roles: ["admin"],
      status: "active",
    });
    await expect(
      service.select("uid", identity, "organization", "two"),
    ).rejects.toMatchObject({
      status: 409,
      code: "REGISTRATION_INTENT_CONFLICT",
    });
    expect(memory.records.get("memberships/workspace_uid")?.roles).toEqual([
      "admin",
    ]);
  });

  it("records only safe audit fields", async () => {
    const { memory, service } = serviceFor();
    await service.select("uid", identity, "organization", "safe-request");
    const audit = [...memory.records.entries()].find(([key]) =>
      key.startsWith("auditLogs/"),
    )?.[1];
    expect(audit).toMatchObject({
      event: "registration.intent_selected",
      actorUid: "uid",
      intent: "organization",
      previousOnboardingState: "new_authenticated_user",
      resultingOnboardingState: "organization_setup_required",
      requestId: "safe-request",
    });
    expect(JSON.stringify(audit)).not.toMatch(/token|password|credential/i);
  });
});
