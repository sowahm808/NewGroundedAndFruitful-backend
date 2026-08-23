import { describe, expect, it } from "vitest";
import { tenantOrganizationCandidate } from "../src/administration/routes.js";

describe("administration organization context", () => {
  it("accepts the workspace identifier used by the frontend team payload", () => {
    const request = {
      query: {},
      body: { workspaceId: " workspace-1 " },
      headers: {},
      principal: undefined,
    };

    expect(tenantOrganizationCandidate(request)).toBe("workspace-1");
  });

  it("continues to prefer an explicit organization identifier", () => {
    const request = {
      query: { workspaceId: "workspace-query" },
      body: { workspaceId: "workspace-body" },
      headers: {},
      principal: undefined,
    };

    expect(tenantOrganizationCandidate(request, "organization-explicit")).toBe(
      "organization-explicit",
    );
  });
});
