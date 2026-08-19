import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "../src/shared/errors.js";
import { AuthorizationPolicy, permissions, rolePermissions, type AuthorizationContext, type Permission, type ResourceScope, type UserRole } from "../src/auth/policy.js";

const relationships = {
  ownsParticipant: vi.fn((uid: string, r: ResourceScope) => Promise.resolve(uid === "actor" && r.participantId === "participant-1")),
  hasParentLink: vi.fn((_uid: string, r: ResourceScope) => Promise.resolve(r.participantId === "participant-1")),
  hasMentorAssignment: vi.fn((_uid: string, r: ResourceScope) => Promise.resolve(r.teamId === "team-1")),
  hasObserverGrant: vi.fn((_uid: string, r: ResourceScope) => Promise.resolve(r.participantId === "participant-1")),
};
const policy = new AuthorizationPolicy(relationships);
const scope: ResourceScope = { organizationId: "org-1", programId: "program-1", participantId: "participant-1", teamId: "team-1" };
function context(role: UserRole, overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return { actorUid: "actor", roles: [role], organizationIds: ["org-1"], memberships: [{ id: "membership-1", userId: "actor", organizationId: "org-1", roles: [role], status: "active", version: 1, programIds: ["program-1"] }], ...overrides };
}

describe("central authorization policy", () => {
  for (const role of ["child", "parent", "mentor", "observer", "admin", "super_admin"] as const) {
    for (const permission of permissions) {
      const expected = rolePermissions[role].includes(permission);
      it(`${role} ${expected ? "allows" : "denies"} ${permission}`, async () => {
        const result = policy.authorize(context(role), permission, scope);
        if (expected) await expect(result).resolves.toBeUndefined();
        else await expect(result).rejects.toBeInstanceOf(AuthorizationError);
      });
    }
  }

  const cases: Array<[string, UserRole, Permission, ResourceScope, boolean]> = [
    ["child own participant", "child", "journey.self.read", scope, true],
    ["child impersonation", "child", "journey.self.read", { ...scope, participantId: "other" }, false],
    ["parent linked child", "parent", "child.linked.read", scope, true],
    ["parent unrelated child", "parent", "child.linked.read", { ...scope, participantId: "other" }, false],
    ["parent raw check-in", "parent", "checkin.self.read", scope, false],
    ["mentor assigned team", "mentor", "team.assigned.read", scope, true],
    ["mentor unassigned team", "mentor", "team.assigned.read", { ...scope, teamId: "other" }, false],
    ["observer active grant", "observer", "observation.granted.create", scope, true],
    ["observer absent grant", "observer", "observation.granted.create", { ...scope, participantId: "other" }, false],
    ["admin own program", "admin", "program.configure", scope, true],
    ["admin role escalation", "admin", "role.manage", scope, false],
    ["super-admin own tenant", "super_admin", "membership.manage", scope, true],
  ];
  it.each(cases)("checks %s", async (_name, role, permission, resource, allowed) => {
    const result = policy.authorize(context(role), permission, resource);
    if (allowed) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("denies cross-program admin access", async () => {
    await expect(policy.authorize(context("admin"), "program.configure", { ...scope, programId: "program-2" })).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("denies super-admin cross-tenant access", async () => {
    await expect(policy.authorize(context("super_admin"), "organization.manage", { organizationId: "org-2" })).rejects.toBeInstanceOf(AuthorizationError);
  });
  it.each(["pending", "suspended", "revoked"] as const)("ignores %s memberships", async (status) => {
    const base = context("super_admin");
    await expect(policy.authorize({ ...base, memberships: [{ ...base.memberships[0]!, status } as never] }, "organization.manage", scope)).rejects.toBeInstanceOf(AuthorizationError);
  });
  it.each(["points.self.read", "role.manage", "team.manage"] as Permission[])("prevents child privileged action %s", async (permission) => {
    const resource = permission === "points.self.read" ? { ...scope, participantId: "other" } : scope;
    await expect(policy.authorize(context("child"), permission, resource)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
