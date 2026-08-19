import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "../src/shared/errors.js";
import { isRole, resolvePrincipal } from "../src/middleware/authentication.js";

function firestore(
  user: Record<string, unknown>,
  memberships: Record<string, unknown>[] = [],
) {
  const get = (field: string) => user[field];
  const query = {
    where: vi.fn(),
    get: vi
      .fn()
      .mockResolvedValue({
        docs: memberships.map((data) => ({ data: () => data })),
      }),
  };
  query.where.mockReturnValue(query);
  return {
    doc: vi
      .fn()
      .mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: true, get }),
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
  it("rejects authenticated users without a server role", async () => {
    await expect(
      resolvePrincipal(
        firestore({ status: "active" }) as never,
        { uid: "user-1" } as never,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
