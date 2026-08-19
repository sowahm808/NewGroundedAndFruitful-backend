import { describe, expect, it } from "vitest";
import { localDateIn, resolveChildContext } from "../src/child/context.js";
import childRouter from "../src/child/routes/index.js";

describe("child workflow contracts", () => {
  it("calculates dates in the organization IANA timezone across DST", () => {
    expect(localDateIn(new Date("2026-03-08T07:30:00Z"), "America/New_York")).toBe("2026-03-08");
    expect(localDateIn(new Date("2026-08-19T00:30:00Z"), "America/Los_Angeles")).toBe("2026-08-18");
  });
  it("registers all child route methods", () => {
    const routes=childRouter.stack.map(layer=>layer.route).filter(Boolean).map(route=>[Object.keys((route as unknown as {methods:Record<string,boolean>}).methods)[0],route?.path].join(" "));
    expect(routes).toEqual(expect.arrayContaining(["get /today","get /character","get /bible","get /reading","get /projects","get /team","post /check-ins/today/complete","post /projects/:projectId/updates"]));
  });
  it("accepts a legacy singular child membership during context resolution", async () => {
    const membership = { get: (field: string) => ({ status: "active", role: "child", organizationId: "org-a", timezone: "UTC" })[field] };
    const participant = { id: "participant-a", get: (field: string) => ({ organizationId: "org-a", status: "active" })[field] };
    const collection = (name: string) => ({ where: () => ({ get: () => Promise.resolve({ docs: name === "memberships" ? [membership] : name === "participants" ? [participant] : [] }) }) });

    await expect(resolveChildContext({ collection } as never, {
      uid: "child-a", role: "child", roles: ["child"], organizationIds: ["org-a"], token: {} as never,
    })).resolves.toMatchObject({ context: { actorUid: "child-a", participantId: "participant-a", organizationId: "org-a" } });
  });
});

import { quarterAcceptsSubmissions } from "../src/child/context.js";
import { requireRole } from "../src/auth/authorization.js";
import type { Principal } from "../src/auth/authorization.js";

const principal = (role: Principal["role"]): Principal => ({
  uid: `user-${role}`,
  role,
  roles: [role],
  organizationIds: ["org-a"],
  token: {} as Principal["token"],
});

describe("child authorization and quarter policy", () => {
  it.each(["parent", "mentor", "observer", "admin", "super_admin"] as const)(
    "denies the %s role without an audited support workflow",
    (role) => expect(() => requireRole(principal(role), "child")).toThrow(),
  );
  it("allows the canonical child role", () => {
    expect(requireRole(principal("child"), "child").uid).toBe("user-child");
  });
  it.each([
    ["open", true], ["checkpoint", true], ["recognition", false],
    ["closed", false], ["archived", false],
  ] as const)("treats %s submission eligibility as %s", (status, expected) => {
    expect(quarterAcceptsSubmissions({ status } as Parameters<typeof quarterAcceptsSubmissions>[0])).toBe(expected);
  });
});

import { readFileSync } from "node:fs";

it("documents every mounted child route in OpenAPI", () => {
  const specification = readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8");
  const mounted = childRouter.stack
    .map((layer) => layer.route?.path)
    .filter((path): path is string => typeof path === "string")
    .map((path) => `/child${path.replace(/:([A-Za-z]+)/g, "{$1}")}:`);
  expect(new Set(mounted).size).toBe(18);
  for (const path of mounted) expect(specification).toContain(`  ${path}`);
});
