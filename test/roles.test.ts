import { describe, expect, it } from "vitest";
import { normalizeRoles } from "../src/auth/roles.js";

describe("role normalization", () => {
  it("normalizes legacy aliases, whitespace, and safe case variations", () => {
    expect(
      normalizeRoles([
        " participant ",
        "GUARDIAN",
        "authorizedAdult",
        "authorized_adult",
        "authorized-adult",
        "administrator",
        "superAdmin",
        "super-admin",
      ]).roles,
    ).toEqual(["child", "parent", "observer", "admin", "super_admin"]);
  });
  it("deduplicates canonical identities", () => {
    expect(
      normalizeRoles(["observer", "authorizedAdult", "OBSERVER"]).roles,
    ).toEqual(["observer"]);
  });
  it("rejects unknown values without promotion", () => {
    expect(normalizeRoles(["owner", "root"]).roles).toEqual([]);
    expect(normalizeRoles(["owner", "root"]).invalid).toEqual([
      "owner",
      "root",
    ]);
  });
});
