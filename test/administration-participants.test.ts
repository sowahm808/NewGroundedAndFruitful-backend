import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";
import administrationRouter from "../src/administration/routes.js";
import { participantListQuerySchema } from "../src/administration/schemas.js";
import { AdministrationService } from "../src/administration/service.js";
import type { Principal } from "../src/auth/authorization.js";
import { AuthorizationError } from "../src/shared/errors.js";

const principal = (
  capabilities: string[] = [
    "admin.participants.read",
    "admin.participants.manage",
  ],
): Principal => ({
  uid: "admin-1",
  role: "admin",
  roles: ["admin"],
  capabilities,
  activeWorkspaceId: "org-1",
  activeOrganizationId: "org-1",
  onboardingStatus: "complete",
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
});

const document = (id: string, data: Record<string, unknown>) => ({
  id,
  exists: true,
  data: () => data,
  get: (field: string) => data[field],
});

const database = (documents: ReturnType<typeof document>[]) => {
  const collection = {
    where: vi.fn(),
    get: vi.fn().mockResolvedValue({ docs: documents }),
    doc: vi.fn(),
  };
  collection.where.mockReturnValue(collection);
  return {
    collection: vi.fn().mockReturnValue(collection),
    doc: vi.fn((path: string) => ({
      get: vi.fn().mockResolvedValue(
        documents.find((item) => path.endsWith(`/${item.id}`)) ?? {
          exists: false,
        },
      ),
    })),
  };
};

const databaseByCollection = (
  collections: Record<string, ReturnType<typeof document>[]>,
) => ({
  collection: vi.fn((name: string) => {
    const query = {
      where: vi.fn(),
      get: vi.fn().mockResolvedValue({ docs: collections[name] ?? [] }),
    };
    query.where.mockReturnValue(query);
    return query;
  }),
});

describe("Admin Participants authorization and list contract", () => {
  it("lists from the active organization without a client organizationId", async () => {
    const db = database([
      document("participant-1", {
        organizationId: "org-1",
        displayName: "Ada",
        status: "active",
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      }),
    ]);
    const service = new AdministrationService(db as never, {} as never);
    const result = await service.roster(
      principal(),
      participantListQuerySchema.parse({
        page: "1",
        pageSize: "25",
        sort: "-updatedAt",
      }),
    );
    expect(db.collection().where).toHaveBeenCalledWith(
      "organizationId",
      "==",
      "org-1",
    );
    expect(result).toEqual({
      items: [expect.objectContaining({ id: "participant-1" })],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    });
  });

  it("hydrates roster fields from organization-scoped records", async () => {
    const db = databaseByCollection({
      participants: [
        document("participant-1", {
          organizationId: "org-1",
          displayName: "Ada",
          status: "active",
          activeTeamId: "team-1",
          updatedAt: new Date("2026-08-01T00:00:00Z"),
        }),
        document("participant-2", {
          organizationId: "org-1",
          displayName: "Grace",
          status: "withdrawn",
          updatedAt: new Date("2026-07-01T00:00:00Z"),
        }),
      ],
      quarters: [
        document("quarter-1", {
          organizationId: "org-1",
          status: "active",
          name: "Fall 2026",
        }),
      ],
      teams: [
        document("team-1", {
          organizationId: "org-1",
          approvedDisplayName: "Orchard Team",
        }),
      ],
      parentChildLinks: [
        document("link-1", {
          organizationId: "org-1",
          status: "active",
          participantId: "participant-1",
          parentUid: "parent-1",
        }),
      ],
      parentProfiles: [
        document("parent-1", {
          organizationId: "org-1",
          displayName: "Alex Guardian",
        }),
      ],
    });
    const service = new AdministrationService(db as never, {} as never);

    const result = await service.roster(
      principal(),
      participantListQuerySchema.parse({ pageSize: "25" }),
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        id: "participant-1",
        linkedGuardian: "Alex Guardian",
        team: "Orchard Team",
        currentQuarterStatus: "Fall 2026",
        allowedActions: ["edit", "assign"],
      }),
      expect.objectContaining({
        id: "participant-2",
        linkedGuardian: null,
        team: null,
        currentQuarterStatus: "Not Enrolled",
        allowedActions: ["edit", "assign"],
      }),
    ]);
    expect(db.collection).toHaveBeenCalledWith("quarters");
    expect(db.collection).toHaveBeenCalledWith("teams");
    expect(db.collection).toHaveBeenCalledWith("parentChildLinks");
    expect(db.collection).toHaveBeenCalledWith("parentProfiles");
    expect(db.collection).toHaveBeenCalledWith("users");
  });

  it("returns an empty offset page instead of failing", async () => {
    const service = new AdministrationService(
      database([]) as never,
      {} as never,
    );
    await expect(
      service.roster(principal(), participantListQuerySchema.parse({})),
    ).resolves.toEqual({
      items: [],
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
    });
  });

  it("rejects a conflicting compatibility organizationId", async () => {
    const service = new AdministrationService(
      database([]) as never,
      {} as never,
    );
    await expect(
      service.roster(
        principal(),
        participantListQuerySchema.parse({ organizationId: "org-2" }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects missing capability and an inactive membership", async () => {
    const service = new AdministrationService(
      database([]) as never,
      {} as never,
    );
    await expect(
      service.roster(principal([]), participantListQuerySchema.parse({})),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const inactive = principal();
    // Authentication omits suspended memberships from the active principal.
    inactive.memberships = [];
    await expect(
      service.roster(inactive, participantListQuerySchema.parse({})),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("enforces active-tenant scope for participant detail", async () => {
    const service = new AdministrationService(
      database([
        document("participant-2", {
          organizationId: "org-2",
          displayName: "Other tenant",
          status: "active",
        }),
      ]) as never,
      {} as never,
    );
    await expect(
      service.participant(principal(), "participant-2"),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("requires manage capability before participant creation", async () => {
    const service = new AdministrationService(
      database([]) as never,
      {} as never,
    );
    await expect(
      service.createParticipant(principal(["admin.participants.read"]), {
        organizationId: "org-1",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("accepts exactly the published frontend-compatible list query", () => {
    expect(
      participantListQuerySchema.parse({
        page: "1",
        pageSize: "25",
        search: " Ada ",
        status: "active",
        teamId: "team-1",
        programId: "program-1",
        sort: "-updatedAt",
      }),
    ).toMatchObject({ page: 1, pageSize: 25, search: "Ada" });
    for (const invalid of [
      { page: "0" },
      { pageSize: "101" },
      { sort: "name" },
      { status: "" },
      { teamId: "" },
      { unsupported: "value" },
    ])
      expect(participantListQuerySchema.safeParse(invalid).success).toBe(false);
  });

  it("mounts read and manage capability middleware on every participant route", () => {
    const routes = administrationRouter.stack
      .map((layer) => layer.route)
      .filter((route) => String(route?.path).startsWith("/participants"))
      .slice(0, 5)
      .map((route) => ({
        path: route?.path,
        method: Object.keys(
          (route as unknown as { methods: Record<string, boolean> }).methods,
        )[0],
        middlewareCount: route?.stack.length,
      }));
    expect(routes).toEqual([
      {
        path: "/participants/:participantId/invite-guardian",
        method: "post",
        middlewareCount: 3,
      },
      { path: "/participants", method: "post", middlewareCount: 2 },
      { path: "/participants", method: "get", middlewareCount: 2 },
      {
        path: "/participants/:participantId",
        method: "get",
        middlewareCount: 2,
      },
      {
        path: "/participants/:participantId",
        method: "patch",
        middlewareCount: 3,
      },
    ]);
  });

  it("publishes the same offset query and response envelope in OpenAPI", () => {
    const specification = parse(
      readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8"),
    );
    const operation = specification.paths["/admin/participants"].get as {
      parameters: Array<{ name: string }>;
      responses: Record<
        string,
        { content: Record<string, { schema: { $ref: string } }> }
      >;
    };
    expect(operation.parameters.map((item) => item.name)).toEqual([
      "page",
      "pageSize",
      "search",
      "status",
      "teamId",
      "programId",
      "sort",
      "organizationId",
    ]);
    expect(
      operation.responses["200"]!.content["application/json"]!.schema.$ref,
    ).toBe("#/components/schemas/ParticipantListResponse");

    const itemSchema = specification.components.schemas.AdminParticipant as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(itemSchema.additionalProperties).toBe(false);
    expect(itemSchema.required).toEqual([
      "id",
      "name",
      "enrollmentStatus",
      "linkedGuardian",
      "team",
      "currentQuarterStatus",
      "updatedAt",
      "allowedActions",
    ]);
    expect(Object.keys(itemSchema.properties)).toEqual(itemSchema.required);
  });
});
