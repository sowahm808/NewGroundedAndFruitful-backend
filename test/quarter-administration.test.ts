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
        status: "active",
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
    expect(() => quarterListQuerySchema.parse({ status: "open" })).toThrow();
  });

  it("accepts only canonical create fields and real calendar dates", () => {
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
      "active",
      "closed",
      "archived",
    ]);
    expect(specification.components.schemas.QuarterUpdate.required).toContain(
      "expectedVersion",
    );
    expect(
      specification.components.schemas.Quarter.properties.createdAt.format,
    ).toBe("date-time");
  });
});
