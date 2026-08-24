import { describe, expect, it, vi } from "vitest";
import { AdministrationService } from "../src/administration/service.js";
import type { Principal } from "../src/auth/authorization.js";

const principal: Principal = {
  uid: "admin-1",
  role: "admin",
  roles: ["admin"],
  organizationIds: ["org-1"],
  memberships: [
    {
      id: "membership-1",
      userId: "admin-1",
      organizationId: "org-1",
      roles: ["admin"],
      status: "active",
      version: 1,
    },
  ],
  token: {} as Principal["token"],
};

const document = (id: string, data: Record<string, unknown>) => ({
  id,
  data: () => data,
});

describe("administration resource lists", () => {
  it("returns and filters canonical content assignments", async () => {
    const collection = {
      where: vi.fn(),
      get: vi.fn().mockResolvedValue({
        docs: [
          document("assignment-1", {
            organizationId: "org-1",
            quarterId: "quarter-1",
            contentType: "reading",
            contentId: "book-1",
            status: "active",
            updatedAt: { toMillis: () => 2 },
          }),
          document("assignment-2", {
            organizationId: "org-1",
            quarterId: "quarter-2",
            contentType: "survey",
            contentId: "survey-1",
            status: "archived",
            updatedAt: { toMillis: () => 1 },
          }),
        ],
      }),
    };
    collection.where.mockReturnValue(collection);
    const db = { collection: vi.fn().mockReturnValue(collection) };
    const service = new AdministrationService(db as never, {} as never);

    const result = await service.listResources(
      principal,
      "contentAssignments",
      {
        organizationId: "org-1",
        page: 1,
        pageSize: 25,
        status: "active",
        quarterId: "quarter-1",
        search: "BOOK",
        sort: "-updatedAt",
      },
    );

    expect(db.collection).toHaveBeenCalledWith("contentAssignments");
    expect(collection.where).toHaveBeenCalledWith(
      "organizationId",
      "==",
      "org-1",
    );
    expect(result).toEqual({
      items: [expect.objectContaining({ id: "assignment-1" })],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    });
  });

  it("treats the all-status option as an unfiltered list", async () => {
    const collection = {
      where: vi.fn(),
      get: vi.fn().mockResolvedValue({
        docs: [
          document("active", { organizationId: "org-1", status: "active" }),
          document("draft", { organizationId: "org-1", status: "draft" }),
        ],
      }),
    };
    collection.where.mockReturnValue(collection);
    const service = new AdministrationService(
      { collection: vi.fn().mockReturnValue(collection) } as never,
      {} as never,
    );

    const result = await service.listResources(
      principal,
      "contentAssignments",
      {
        organizationId: "org-1",
        page: 1,
        pageSize: 25,
        status: "all",
        sort: "-updatedAt",
      },
    );

    expect(result.items).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
  });
});
