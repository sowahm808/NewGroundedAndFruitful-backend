import { describe, expect, it, vi } from "vitest";
import type { Principal } from "../src/auth/authorization.js";
import { deriveCapabilities } from "../src/auth/capabilities.js";
import {
  reportDefinitionListQuerySchema,
  reportJobListQuerySchema,
} from "../src/reports/schemas.js";
import { ReportService } from "../src/reports/service.js";

const admin = (
  organizationId = "org-a",
  capabilities = ["admin.reports.read", "admin.reports.manage"],
): Principal => ({
  uid: "admin-1",
  role: "admin",
  roles: ["admin"],
  capabilities,
  activeWorkspaceId: organizationId,
  organizationIds: [organizationId],
  memberships: [
    {
      id: "m1",
      userId: "admin-1",
      organizationId,
      workspaceId: organizationId,
      roles: ["admin"],
      status: "active",
      version: 1,
    },
  ],
  token: {} as Principal["token"],
});
const snapshot = (id: string, data?: Record<string, unknown>) => ({
  id,
  exists: Boolean(data),
  data: () => data ?? {},
  get: (key: string) => data?.[key],
});
const listDb = (docs: Array<ReturnType<typeof snapshot>>) => ({
  collection: () => ({
    where: () => ({ get: () => Promise.resolve({ docs }) }),
  }),
});

describe("admin report contracts", () => {
  it("projects read and manage capabilities for the Admin persona", () => {
    expect(deriveCapabilities(["admin"], ["admin"], ["admin"])).toEqual(
      expect.arrayContaining(["admin.reports.read", "admin.reports.manage"]),
    );
  });
  it("has endpoint-specific strict query, paging, and sort contracts", () => {
    expect(
      reportDefinitionListQuerySchema.parse({ organizationId: "org-a" }),
    ).toMatchObject({ page: 1, pageSize: 25, sort: "name" });
    expect(
      reportJobListQuerySchema.parse({ organizationId: "org-a" }),
    ).toMatchObject({ page: 1, pageSize: 25, sort: "-createdAt" });
    expect(
      reportJobListQuerySchema.safeParse({
        organizationId: "org-a",
        sort: "-updatedAt",
      }).success,
    ).toBe(false);
    const invalid = reportJobListQuerySchema.safeParse({
      organizationId: "org-a",
      pageSize: 101,
    });
    expect(
      invalid.success ? {} : invalid.error.flatten().fieldErrors,
    ).toHaveProperty("pageSize");
  });
  it("returns a 200-compatible empty page without broadening tenant scope", async () => {
    const db = listDb([]);
    const service = new ReportService(db as never);
    await expect(
      service.jobs(admin(), {
        organizationId: "org-a",
        page: 1,
        pageSize: 25,
        sort: "-createdAt",
      }),
    ).resolves.toEqual({
      items: [],
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
    });
    await expect(
      service.jobs(admin(), {
        organizationId: "org-b",
        page: 1,
        pageSize: 25,
        sort: "-createdAt",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("makes report creation idempotent for the same actor and key", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ code: 6 });
    const db = {
      doc: (path: string) =>
        path.startsWith("participants/")
          ? {
              get: () =>
                Promise.resolve(snapshot("p1", { organizationId: "org-a" })),
            }
          : path.startsWith("reportPolicies/")
            ? {
                get: () =>
                  Promise.resolve(
                    snapshot("policy", {
                      organizationId: "org-a",
                      status: "approved",
                      storageExpirySeconds: 60,
                      redactionProfile: "standard",
                    }),
                  ),
              }
            : { create },
    };
    const service = new ReportService(db as never),
      input = {
        organizationId: "org-a",
        participantId: "p1",
        reportType: "progress",
        policyVersion: "1",
        idempotencyKey: "request_01",
      };
    const first = await service.request(admin(), input),
      second = await service.request(admin(), input);
    expect(first).toEqual(second);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("requires active-workspace scope and does not expose another tenant's rows", async () => {
    const service = new ReportService(
      listDb([
        snapshot("foreign", { organizationId: "org-b", createdAt: 1 }),
      ]) as never,
    );
    const wrongWorkspace = { ...admin(), activeWorkspaceId: "org-b" };
    await expect(
      service.jobs(wrongWorkspace, {
        organizationId: "org-a",
        page: 1,
        pageSize: 25,
        sort: "-createdAt",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("bounds signed downloads by storage expiry and audits access", async () => {
    const expires = { toMillis: () => Date.parse("2026-01-01T00:02:00Z") };
    const create = vi.fn().mockResolvedValue(undefined),
      getSignedUrl = vi.fn().mockResolvedValue(["signed"]);
    const db = {
      doc: (path: string) =>
        path.startsWith("reportJobs/")
          ? {
              get: () =>
                Promise.resolve(
                  snapshot("job", {
                    organizationId: "org-a",
                    participantId: "p1",
                    status: "ready",
                    expiresAt: expires,
                    objectPath: "private-reports/org-a/job",
                  }),
                ),
            }
          : {
              get: () =>
                Promise.resolve(snapshot("p1", { organizationId: "org-a" })),
            },
      collection: () => ({ doc: () => ({ create }) }),
    };
    const bucket = { file: () => ({ save: vi.fn(), getSignedUrl }) };
    const result = await new ReportService(
      db as never,
      bucket,
    ).download(admin(), "job", new Date("2026-01-01T00:00:00Z"));
    expect(result).toEqual({
      url: "signed",
      expiresAt: "2026-01-01T00:02:00.000Z",
    });
    expect(getSignedUrl).toHaveBeenCalledWith({
      action: "read",
      expires: Date.parse("2026-01-01T00:02:00Z"),
    });
    expect(create).toHaveBeenCalledOnce();
  });
});
