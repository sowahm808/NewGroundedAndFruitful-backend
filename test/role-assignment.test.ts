import { describe, expect, it, vi } from "vitest";
import { assignRole } from "../src/auth/services/role-assignment.js";

function fixture(roles: unknown = ["parent"]) {
  const data = { uid: "uid-1", roles };
  const transaction = {
    get: vi.fn().mockResolvedValue({ exists: true, data: () => data }),
    update: vi.fn(),
    set: vi.fn(),
  };
  const add = vi.fn().mockResolvedValue(undefined);
  const membershipGet = vi.fn().mockResolvedValue({ docs: [] });
  const where = vi.fn(() => ({ get: membershipGet }));
  const db = {
    doc: vi.fn((path: string) => ({ path })),
    runTransaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
      Promise.resolve(callback(transaction)),
    ),
    collection: vi.fn(() => ({ add, where })),
  };
  const auth = {
    getUser: vi
      .fn()
      .mockResolvedValue({ uid: "uid-1", customClaims: { theme: "dark" } }),
    setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
  };
  return { auth, db, transaction, add };
}

describe("operational role assignment", () => {
  it("adds a super-admin transactionally, audits, and preserves unrelated claims", async () => {
    const { auth, db, transaction } = fixture();
    await expect(
      assignRole(auth as never, db as never, {
        uid: "uid-1",
        role: "super_admin",
        updatedBy: "admin-role-cli",
        actorRoles: ["super_admin"],
      }),
    ).resolves.toEqual({
      roles: ["parent", "super_admin"],
      changed: true,
      claimsSynchronized: true,
    });
    expect(transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        roles: ["parent", "super_admin"],
        updatedBy: "admin-role-cli",
      }),
    );
    expect(transaction.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: "USER_ROLE_ASSIGNED",
        role: "super_admin",
      }),
    );
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith("uid-1", {
      theme: "dark",
      platformRoles: ["super_admin"],
      roles: ["super_admin"],
    });
  });

  it("is idempotent when the role already exists", async () => {
    const { auth, db, transaction } = fixture(["super_admin"]);
    await expect(
      assignRole(auth as never, db as never, {
        uid: "uid-1",
        role: "super_admin",
        updatedBy: "admin-role-cli",
        actorRoles: ["super_admin"],
      }),
    ).resolves.toMatchObject({ changed: false, roles: ["super_admin"] });
    expect(transaction.update).not.toHaveBeenCalled();
    expect(transaction.set).not.toHaveBeenCalled();
  });

  it("rejects aliases, unknown roles, and invalid stored role arrays", async () => {
    const unknown = fixture();
    await expect(
      assignRole(unknown.auth as never, unknown.db as never, {
        uid: "uid-1",
        role: "administrator" as never,
        updatedBy: "admin-role-cli",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(unknown.auth.getUser).not.toHaveBeenCalled();

    const invalidStored = fixture(["root"]);
    await expect(
      assignRole(invalidStored.auth as never, invalidStored.db as never, {
        uid: "uid-1",
        role: "admin",
        updatedBy: "admin-role-cli",
        actorRoles: ["super_admin"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("records a retryable audit event when custom-claim synchronization fails", async () => {
    const { auth, db, add } = fixture([]);
    auth.setCustomUserClaims.mockRejectedValueOnce(new Error("claim failure"));
    await expect(
      assignRole(auth as never, db as never, {
        uid: "uid-1",
        role: "parent",
        updatedBy: "admin-role-cli",
      }),
    ).rejects.toThrow("claim failure");
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "USER_ROLE_CLAIM_SYNC_FAILED",
        retryable: true,
      }),
    );
  });

  it("requires super_admin for elevated assignment", async () => {
    const { auth, db } = fixture([]);
    await expect(
      assignRole(auth as never, db as never, {
        uid: "uid-1",
        role: "admin",
        updatedBy: "admin-1",
        actorRoles: ["admin"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("prevents generic replacement from removing a super_admin", async () => {
    const { auth, db } = fixture(["super_admin"]);
    await expect(
      assignRole(auth as never, db as never, {
        uid: "uid-1",
        role: "parent",
        replace: true,
        updatedBy: "root",
        actorRoles: ["super_admin"],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
