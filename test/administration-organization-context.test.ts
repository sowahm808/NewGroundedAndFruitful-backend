import { describe, expect, it } from "vitest";
import { tenantOrganizationCandidate } from "../src/administration/routes.js";
import { resourceCreateSchema } from "../src/administration/schemas.js";

describe("administration organization context", () => {
  it("does not accept a client-controlled workspace alias", () => {
    const request = {
      query: {},
      body: { workspaceId: " workspace-1 " },
      headers: {},
      principal: undefined,
    };

    expect(tenantOrganizationCandidate(request)).toBeUndefined();
  });

  it("uses only a single active canonical membership as a fallback", () => {
    const request = {
      query: {},
      body: {},
      headers: {},
      principal: {
        memberships: [
          { organizationId: "org-1", status: "active" },
          { organizationId: "org-2", status: "revoked" },
        ],
      },
    };
    expect(tenantOrganizationCandidate(request)).toBe("org-1");
  });

  it("refuses to silently select among active memberships", () => {
    const request = {
      query: {},
      body: {},
      headers: {},
      principal: {
        memberships: [
          { organizationId: "org-1", status: "active" },
          { organizationId: "org-2", status: "active" },
        ],
      },
    };
    expect(tenantOrganizationCandidate(request)).toBeUndefined();
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

  it("allows resource creates to receive organization context from the session", () => {
    const request = {
      query: {},
      body: {
        organizationId: undefined,
        name: "Week one",
        data: { week: 1 },
      },
      headers: {},
      principal: {
        activeOrganizationId: "org-1",
        memberships: [{ organizationId: "org-1", status: "active" }],
      },
    };

    const organizationId = tenantOrganizationCandidate(request);
    expect(
      resourceCreateSchema.parse({ ...request.body, organizationId }),
    ).toEqual({
      organizationId: "org-1",
      name: "Week one",
      data: { week: 1 },
    });
  });
});
