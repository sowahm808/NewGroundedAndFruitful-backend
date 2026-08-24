import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import administrationRouter from "../src/administration/routes.js";
import {
  quarterCreateSchema,
  quarterLifecycleSchema,
  quarterListQuerySchema,
  quarterUpdateSchema,
} from "../src/administration/schemas.js";
import { QuarterAdministrationService } from "../src/administration/quarters.js";
import type { Principal } from "../src/auth/authorization.js";

const principal = (
  roles: Principal["roles"],
  organizationIds: readonly string[],
): Principal => ({
  uid: "admin-1",
  role: roles[0]!,
  roles,
  organizationIds,
  memberships: organizationIds.map((organizationId, index) => ({
    id: `membership-${String(index)}`,
    userId: "admin-1",
    organizationId,
    roles,
    status: "active" as const,
    version: 1,
  })),
  token: {} as Principal["token"],
});

const snapshot = (id: string, data: Record<string, unknown>) => ({
  id,
  exists: true,
  get: (field: string) => data[field],
});

describe("quarter administration validation", () => {
  it("applies list defaults and validates filters, paging, and sorting", () => {
    expect(quarterListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      sort: "updated_desc",
    });
    expect(
      quarterListQuerySchema.parse({
        page: "2",
        pageSize: "100",
        status: "open",
        sort: "start_date_asc",
        search: "  Fall  ",
      }),
    ).toMatchObject({ page: 2, pageSize: 100, search: "Fall" });
    expect(quarterListQuerySchema.parse({ sort: "-updatedAt" }).sort).toBe(
      "updated_desc",
    );
    expect(quarterListQuerySchema.parse({ sort: "startDate" }).sort).toBe(
      "start_date_asc",
    );
    expect(() => quarterListQuerySchema.parse({ pageSize: 101 })).toThrow();
    expect(() => quarterListQuerySchema.parse({ status: "active" })).toThrow();
  });

  it("accepts canonical or compatibility date fields and real calendar dates", () => {
    const valid = {
      name: "  Fall 2026 ",
      description: null,
      startDate: "2026-09-01",
      endDate: "2026-11-30",
      organizationId: "org-1",
    };
    expect(quarterCreateSchema.parse(valid).name).toBe("Fall 2026");
    const organizationScoped = {
      name: valid.name,
      description: valid.description,
      startDate: valid.startDate,
      endDate: valid.endDate,
    };
    expect(quarterCreateSchema.parse(organizationScoped)).toEqual({
      ...organizationScoped,
      name: "Fall 2026",
    });
    expect(
      quarterCreateSchema.parse({
        name: "September Quarter",
        startsOn: "2026-09-01",
        endsOn: "2026-11-01",
      }),
    ).toEqual({
      name: "September Quarter",
      startDate: "2026-09-01",
      endDate: "2026-11-01",
    });
    expect(() =>
      quarterCreateSchema.parse({
        name: "Mixed fields",
        startDate: "2026-09-01",
        endsOn: "2026-11-01",
      }),
    ).toThrow();
    for (const forbidden of [
      "id",
      "status",
      "createdAt",
      "createdBy",
      "version",
    ])
      expect(() =>
        quarterCreateSchema.parse({ ...valid, [forbidden]: "client" }),
      ).toThrow();
    expect(() =>
      quarterCreateSchema.parse({ ...valid, startDate: "2026-02-30" }),
    ).toThrow();
  });

  it("requires optimistic concurrency and excludes lifecycle updates", () => {
    expect(
      quarterUpdateSchema.parse({ name: "Winter", expectedVersion: 2 }),
    ).toEqual({
      name: "Winter",
      expectedVersion: 2,
    });
    expect(() => quarterUpdateSchema.parse({ expectedVersion: 2 })).toThrow();
    expect(() =>
      quarterUpdateSchema.parse({ status: "active", expectedVersion: 2 }),
    ).toThrow();
    expect(quarterLifecycleSchema.parse({ expectedVersion: 1 })).toEqual({
      expectedVersion: 1,
    });
  });
});

describe("quarter creation organization inference", () => {
  const resolveOrganization = async (
    actor: Principal,
    organizationIds: string[],
    requestedOrganizationId?: string,
  ) => {
    const db = {
      collection: () => ({
        limit: () => ({
          get: () =>
            Promise.resolve({
              size: organizationIds.length,
              docs: organizationIds.map((id) => ({ id })),
            }),
        }),
      }),
    };
    const service = new QuarterAdministrationService(db as never);
    return (
      service as unknown as {
        creationOrganization(
          actor: Principal,
          requestedOrganizationId?: string,
        ): Promise<string | undefined>;
      }
    ).creationOrganization(actor, requestedOrganizationId);
  };

  it("never infers an organization for an unscoped tenant super administrator", async () => {
    await expect(
      resolveOrganization(principal(["super_admin"], []), ["org-1"]),
    ).resolves.toBeUndefined();
  });

  it("requires an explicit selection when multiple deployment organizations exist", async () => {
    await expect(
      resolveOrganization(principal(["super_admin"], []), ["org-1", "org-2"]),
    ).resolves.toBeUndefined();
  });

  it("prefers the requested organization over inferred scope", async () => {
    await expect(
      resolveOrganization(
        principal(["super_admin"], []),
        ["org-1"],
        "org-requested",
      ),
    ).resolves.toBe("org-requested");
  });
});

describe("quarter tenant projections", () => {
  const quarter = (id: string, organizationId: string, status = "draft") =>
    snapshot(id, {
      name: `Quarter ${id}`,
      description: null,
      startDate: "2026-09-01",
      endDate: "2026-11-30",
      status,
      organizationId,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      updatedAt: new Date("2026-08-02T00:00:00Z"),
      createdBy: "admin-1",
      updatedBy: "admin-1",
      version: 1,
    });

  const service = (quarters: ReturnType<typeof quarter>[]) => {
    const workspaces = new Map([
      [
        "org-1",
        snapshot("org-1", {
          name: "Makrozoia Solutions LLC",
          type: "organization",
        }),
      ],
      [
        "org-2",
        snapshot("org-2", { name: "Other Tenant", type: "organization" }),
      ],
    ]);
    const db = {
      collection: (name: string) => {
        if (name !== "quarters")
          throw new Error(`Unexpected collection ${name}`);
        return { get: () => Promise.resolve({ docs: quarters }) };
      },
      doc: (path: string) => {
        const [collection, id] = path.split("/");
        if (collection === "workspaces")
          return { path, get: () => Promise.resolve(workspaces.get(id!)) };
        const found = quarters.find((item) => item.id === id);
        return { path, get: () => Promise.resolve(found) };
      },
      getAll: (...refs: Array<{ path: string }>) =>
        Promise.resolve(
          refs.map((ref) => workspaces.get(ref.path.split("/")[1]!)!),
        ),
    };
    return new QuarterAdministrationService(db as never);
  };

  it("returns the authoritative minimal workspace and lifecycle actions", async () => {
    const result = await service([quarter("q-1", "org-1")]).list(
      principal(["admin"], ["org-1"]),
      quarterListQuerySchema.parse({}),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        organizationId: "org-1",
        workspace: {
          id: "org-1",
          name: "Makrozoia Solutions LLC",
          type: "organization",
        },
        allowedActions: ["view", "edit", "activate"],
      }),
    ]);
  });

  it("normalizes quarters activated with the legacy status", async () => {
    const result = await service([quarter("q-1", "org-1", "active")]).list(
      principal(["admin"], ["org-1"]),
      quarterListQuerySchema.parse({ status: "open" }),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        status: "open",
        allowedActions: ["view", "close"],
      }),
    ]);
  });

  it("does not leak cross-tenant quarters or workspace names", async () => {
    const result = await service([
      quarter("q-1", "org-1"),
      quarter("q-2", "org-2"),
    ]).list(principal(["admin"], ["org-1"]), quarterListQuerySchema.parse({}));
    expect(result.items.map((item) => item.id)).toEqual(["q-1"]);
    expect(JSON.stringify(result)).not.toContain("Other Tenant");
  });
});

describe("published quarter contract", () => {
  it("registers dedicated routes and never exposes a delete endpoint", () => {
    const routes = administrationRouter.stack
      .map((layer) => layer.route)
      .filter((route) => String(route?.path).startsWith("/quarters"))
      .map((route) => ({
        path: route?.path,
        methods: (route as unknown as { methods: Record<string, boolean> })
          .methods,
      }));
    expect(routes).toEqual([
      { path: "/quarters", methods: { get: true } },
      { path: "/quarters/:quarterId", methods: { get: true } },
      { path: "/quarters", methods: { post: true } },
      { path: "/quarters/:quarterId", methods: { patch: true } },
      { path: "/quarters/:quarterId/activate", methods: { post: true } },
      { path: "/quarters/:quarterId/close", methods: { post: true } },
      { path: "/quarters/:quarterId/archive", methods: { post: true } },
    ]);
  });

  it("publishes every operation, DTO, enum, security requirement, and concurrency field", () => {
    const specification = parse(
      readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8"),
    );
    const paths = specification.paths;
    expect(paths["/admin/quarters"].get.security).toEqual([
      { firebaseBearer: [] },
    ]);
    expect(paths["/admin/quarters"].post).toBeTruthy();
    expect(paths["/admin/quarters/{quarterId}"].patch).toBeTruthy();
    for (const action of ["activate", "close", "archive"])
      expect(paths[`/admin/quarters/{quarterId}/${action}`].post).toBeTruthy();
    expect(specification.components.schemas.QuarterStatus.enum).toEqual([
      "draft",
      "open",
      "closed",
      "archived",
    ]);
    expect(specification.components.schemas.QuarterUpdate.required).toContain(
      "expectedVersion",
    );
    expect(
      specification.components.schemas.Quarter.properties.createdAt.format,
    ).toBe("date-time");
    expect(specification.components.schemas.Quarter.required).toEqual(
      expect.arrayContaining(["organizationId", "workspace", "allowedActions"]),
    );
    expect(specification.components.schemas.QuarterWorkspace.required).toEqual([
      "id",
      "name",
      "type",
    ]);
  });
});
