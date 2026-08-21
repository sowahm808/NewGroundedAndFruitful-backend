import { describe, expect, it } from "vitest";
import { deriveCapabilities } from "../src/auth/capabilities.js";
import {
  requireCapability,
  type Principal,
} from "../src/auth/authorization.js";

const principal = (capabilities: string[]): Principal => ({
  uid: "actor-1",
  role: "owner",
  roles: ["owner"],
  workspaceRoles: ["owner"],
  personas: capabilities.length ? ["parent"] : [],
  capabilities,
  activeWorkspaceId: "personal-1",
  organizationIds: ["personal-1"],
  memberships: [],
  token: {} as Principal["token"],
});

describe("persona capability policy", () => {
  it("does not equate personal ownership with parent or admin authority", () => {
    expect(deriveCapabilities([], ["owner"], ["owner"])).toEqual([]);
    expect(() =>
      requireCapability(principal([]), "parent.children.read"),
    ).toThrow();
  });

  it("derives parent access without administrative authority", () => {
    const capabilities = deriveCapabilities(["parent"], ["owner"], ["owner"]);
    expect(
      requireCapability(principal(capabilities), "parent.children.read").uid,
    ).toBe("actor-1");
    expect(capabilities).not.toContain("admin.quarters.manage");
  });

  it("does not give an organization admin parent access without a persona", () => {
    const capabilities = deriveCapabilities([], ["admin"], ["admin"]);
    expect(capabilities).toContain("admin.quarters.manage");
    expect(capabilities).not.toContain("parent.children.read");
  });
});
