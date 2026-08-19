import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "../src/shared/errors.js";
import { isRole, resolvePrincipal } from "../src/middleware/authentication.js";

function firestore(
  user: Record<string, unknown> | undefined,
  memberships: Record<string, unknown>[] = [],
) {
  const get = (field: string) => user?.[field];
  const query = {
    where: vi.fn(),
    get: vi.fn().mockResolvedValue({
      docs: memberships.map((data) => ({ data: () => data })),
    }),
  };
  query.where.mockReturnValue(query);
  return {
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: Boolean(user), get }),
    }),
    collection: vi.fn().mockReturnValue(query),
  };
}

describe("server-authoritative authentication role resolution", () => {
  it("recognizes only canonical role values", () => {
    expect(isRole("parent")).toBe(true);
    expect(isRole("guardian")).toBe(false);
  });
  it("ignores claims and resolves an active membership", async () => {
    const db = firestore({ status: "active" }, [
      {
        userId: "parent-1",
        organizationId: "org-1",
        roles: ["guardian"],
        status: "active",
      },
    ]);
    await expect(
      resolvePrincipal(
        db as never,
        { uid: "parent-1", roles: ["admin"] } as never,
      ),
    ).resolves.toEqual({ roles: ["parent"], organizationIds: ["org-1"] });
  });
  it("authorizes an active membership before an optional profile is provisioned", async () => {
    const db = firestore(undefined, [
      {
        userId: "child-1",
        organizationId: "org-1",
        roles: ["child"],
        status: "active",
      },
    ]);
    await expect(
      resolvePrincipal(db as never, { uid: "child-1" } as never),
    ).resolves.toEqual({ roles: ["child"], organizationIds: ["org-1"] });
  });
  it("still rejects an identity with neither a profile role nor an active membership", async () => {
    await expect(
      resolvePrincipal(
        firestore(undefined) as never,
        { uid: "user-1" } as never,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("rejects authenticated users without a server role", async () => {
    await expect(
      resolvePrincipal(
        firestore({ status: "active" }) as never,
        { uid: "user-1" } as never,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("keeps a transitional global parent role but grants no tenant scope", async () => {
    await expect(
      resolvePrincipal(
        firestore({ status: "active", roles: ["parent"] }) as never,
        { uid: "parent-1" } as never,
      ),
    ).resolves.toEqual({ roles: ["parent"], organizationIds: [] });
  });
  it("allows a genuinely global super-admin without fabricating membership", async () => {
    await expect(
      resolvePrincipal(
        firestore({ status: "active", roles: ["super_admin"] }) as never,
        { uid: "root-1" } as never,
      ),
    ).resolves.toEqual({ roles: ["super_admin"], organizationIds: [] });
  });
});
