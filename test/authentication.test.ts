import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "../src/shared/errors.js";
import {
  isRole,
  resolvePrincipalRole,
} from "../src/middleware/authentication.js";

describe("authentication role resolution", () => {
  it("accepts roles from verified Firebase custom claims", () => {
    expect(isRole("parent")).toBe(true);
    expect(isRole("guest")).toBe(false);
  });

  it("uses the server-side user document role when a Firebase token has no role claim", async () => {
    const firestore = {
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ get: () => "parent" }),
      }),
    };

    await expect(
      resolvePrincipalRole(firestore as never, { uid: "parent-1" } as never),
    ).resolves.toBe("parent");
    expect(firestore.doc).toHaveBeenCalledWith("users/parent-1");
  });

  it("rejects authenticated users without an allowed application role", async () => {
    const firestore = {
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ get: () => "guest" }),
      }),
    };

    await expect(
      resolvePrincipalRole(firestore as never, { uid: "user-1" } as never),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
