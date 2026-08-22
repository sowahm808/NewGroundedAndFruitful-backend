import { describe, expect, it } from "vitest";
import {
  authorizedClaims,
  effectiveRoles,
  trustedPlatformRoles,
} from "../src/auth/claims.js";

describe("authorization claims policy", () => {
  it("preserves a corroborated legacy super_admin while adding membership admin", () => {
    const platformRoles = trustedPlatformRoles({ roles: ["super_admin"] }, [
      "super_admin",
    ]);
    expect(platformRoles).toEqual(["super_admin"]);
    expect(effectiveRoles(platformRoles, ["admin"])).toEqual([
      "super_admin",
      "admin",
    ]);
  });

  it("does not grant super_admin from an admin membership or uncorroborated claim", () => {
    expect(trustedPlatformRoles({ roles: ["super_admin"] }, [])).toEqual([]);
    expect(effectiveRoles([], ["admin"])).toEqual(["admin"]);
  });

  it("preserves approved metadata but drops unknown privilege-bearing claims", () => {
    expect(
      authorizedClaims(
        {
          environment: "production",
          sessionVersion: 2,
          root: true,
          isAdmin: true,
        },
        ["super_admin"],
        ["super_admin", "admin"],
      ),
    ).toEqual({
      environment: "production",
      sessionVersion: 2,
      platformRoles: ["super_admin"],
      roles: ["super_admin", "admin"],
    });
  });

  it("does not restore an explicitly absent platform role", () => {
    expect(
      trustedPlatformRoles({ platformRoles: [], roles: ["admin"] }, [
        "super_admin",
      ]),
    ).toEqual([]);
  });

  it("only aggregates active membership roles supplied by the canonical caller", () => {
    expect(effectiveRoles(["super_admin"], ["admin"])).toEqual([
      "super_admin",
      "admin",
    ]);
    expect(effectiveRoles(["super_admin"], [])).toEqual(["super_admin"]);
  });
});
