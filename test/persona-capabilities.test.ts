import { describe, expect, it } from "vitest";
import {
  deriveCapabilities,
  resolvePersonas,
} from "../src/auth/capabilities.js";
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
    expect(resolvePersonas([], ["owner"], ["owner"])).toEqual([]);
    expect(deriveCapabilities([], ["owner"], ["owner"])).toEqual([]);
    expect(() =>
      requireCapability(principal([]), "parent.children.read"),
    ).toThrow();
  });

  it.each(["child", "parent", "mentor", "observer"] as const)(
    "restores the %s persona from a canonical legacy membership role",
    (role) => {
      const personas = resolvePersonas(undefined, [], [role]);
      expect(personas).toEqual([role]);
      expect(deriveCapabilities(personas, [], [role])).toEqual(
        expect.arrayContaining([
          `${role}.${role === "mentor" ? "teams" : role === "observer" ? "subjects" : role === "parent" ? "children" : "today"}.read`,
        ]),
      );
    },
  );

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
    expect(capabilities).toEqual(
      expect.arrayContaining([
        "admin.dashboard.read",
        "admin.participants.read",
        "admin.teams.read",
        "admin.assignments.read",
        "admin.character_content.read",
        "admin.bible_content.read",
        "admin.family_activities.read",
        "admin.books.read",
        "admin.projects.read",
        "admin.surveys.read",
        "admin.point_rules.read",
        "admin.reports.read",
        "admin.awards.read",
        "admin.audit_summaries.read",
      ]),
    );
    expect(
      capabilities.some((capability) => capability.startsWith("tenant.")),
    ).toBe(false);
    expect(capabilities).not.toContain("parent.children.read");
  });

  it("gives a tenant super admin explicit operations and tenant controls", () => {
    const capabilities = deriveCapabilities([], [], ["super_admin"]);
    expect(capabilities).toEqual(
      expect.arrayContaining([
        "admin.dashboard.read",
        "admin.participants.manage",
        "tenant.memberships.manage",
        "tenant.configuration.manage",
        "tenant.administrators.manage",
        "tenant.lifecycle.manage",
        "tenant.operations.manage",
        "tenant.audit.read",
      ]),
    );
    expect(capabilities).not.toContain("*");
  });

  it("combines personas without duplicate capabilities", () => {
    const capabilities = deriveCapabilities(
      ["admin", "parent", "mentor"],
      ["admin"],
      ["admin"],
    );
    expect(capabilities).toContain("parent.children.read");
    expect(capabilities).toContain("mentor.teams.read");
    expect(new Set(capabilities).size).toBe(capabilities.length);
  });
});
