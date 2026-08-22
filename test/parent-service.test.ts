import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { ParentService } from "../src/parent/service.js";

const observation = (id: string, organizationId: string, createdAt: string) => {
  const values: Record<string, unknown> = {
    parentUid: "parent-1",
    participantId: `child-${id}`,
    organizationId,
    qualityId: null,
    description: `Observation ${id}`,
    observedAt: Timestamp.fromDate(new Date(createdAt)),
    moderationStatus: "pending",
    createdAt: Timestamp.fromDate(new Date(createdAt)),
  };
  return { id, get: (field: string) => values[field] };
};

describe("ParentService observations", () => {
  it("lists authorized observations without requiring a composite index", async () => {
    const docs = [
      observation("old", "org-1", "2026-01-01T00:00:00.000Z"),
      observation("other-org", "org-2", "2026-03-01T00:00:00.000Z"),
      observation("new", "org-1", "2026-02-01T00:00:00.000Z"),
    ];
    const links = [
      {
        id: "link-old",
        get: (field: string) =>
          ({
            status: "active",
            organizationId: "org-1",
            participantId: "child-old",
          })[field],
      },
      {
        id: "link-new",
        get: (field: string) =>
          ({
            status: "active",
            organizationId: "org-1",
            participantId: "child-new",
          })[field],
      },
    ];
    const db = {
      collection: (name: string) => {
        const query = {
          where: () => query,
          limit: () => query,
          get: () =>
            Promise.resolve({
              docs: name === "characterObservations" ? docs : links,
            }),
        };
        return query;
      },
    } as unknown as Firestore;
    const service = new ParentService(db);

    await expect(
      service.observations(
        { uid: "parent-1", organizationIds: ["org-1"] },
        { limit: 1 },
      ),
    ).resolves.toMatchObject({
      data: [{ id: "new", childId: "child-new" }],
      meta: { nextCursor: "new" },
    });
    await expect(
      service.observations(
        { uid: "parent-1", organizationIds: ["org-1"] },
        { limit: 1, cursor: "new" },
      ),
    ).resolves.toMatchObject({
      data: [{ id: "old", childId: "child-old" }],
      meta: { nextCursor: null },
    });
  });

  it("returns an empty collection and propagates repository failures for sanitization", async () => {
    const emptyDb = {
      collection: () => ({
        where: () => ({
          limit: () => ({ get: () => Promise.resolve({ docs: [] }) }),
        }),
      }),
    } as unknown as Firestore;
    await expect(
      new ParentService(emptyDb).observations(
        { uid: "parent-1", organizationIds: ["org-1"] },
        { limit: 20 },
      ),
    ).resolves.toEqual({ data: [], meta: { nextCursor: null } });

    const failure = new Error("raw Firestore detail");
    const failedDb = {
      collection: () => ({
        where: () => ({
          limit: () => ({ get: () => Promise.reject(failure) }),
        }),
      }),
    } as unknown as Firestore;
    await expect(
      new ParentService(failedDb).observations(
        { uid: "parent-1", organizationIds: ["org-1"] },
        { limit: 20 },
      ),
    ).rejects.toBe(failure);
  });
});

describe("ParentService notifications", () => {
  it("returns only the authenticated parent's tenant-scoped notifications", async () => {
    const notification = (
      id: string,
      organizationId: string,
      createdAt: string,
    ) => {
      const values: Record<string, unknown> = {
        organizationId,
        type: "announcement",
        title: `Title ${id}`,
        message: `Message ${id}`,
        read: false,
        createdAt: Timestamp.fromDate(new Date(createdAt)),
        internalDeliveryData: "must not be returned",
      };
      return { id, get: (field: string) => values[field] };
    };
    const docs = [
      notification("older", "org-1", "2026-01-01T00:00:00.000Z"),
      notification("cross-tenant", "org-2", "2026-03-01T00:00:00.000Z"),
      notification("newer", "org-1", "2026-02-01T00:00:00.000Z"),
    ];
    const query = {
      where: () => query,
      limit: () => query,
      get: () => Promise.resolve({ docs }),
    };
    const db = { collection: () => query } as unknown as Firestore;
    const service = new ParentService(db);

    await expect(
      service.notifications(
        { uid: "parent-1", organizationIds: ["org-1"] },
        { limit: 1 },
      ),
    ).resolves.toEqual({
      data: [
        {
          id: "newer",
          organizationId: "org-1",
          type: "announcement",
          title: "Title newer",
          message: "Message newer",
          read: false,
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      meta: { nextCursor: "newer" },
    });
    await expect(
      service.notifications(
        { uid: "parent-1", organizationIds: ["org-1"] },
        { limit: 20, cursor: "newer" },
      ),
    ).resolves.toMatchObject({
      data: [{ id: "older" }],
      meta: { nextCursor: null },
    });
  });

  it("uses only the selected active workspace when a parent belongs to multiple tenants", async () => {
    const notification = (id: string, organizationId: string) => ({
      id,
      get: (field: string) =>
        ({
          organizationId,
          type: "announcement",
          title: id,
          message: id,
          read: false,
          createdAt: "2026-08-22T00:00:00.000Z",
        })[field],
    });
    const query = {
      where: () => query,
      limit: () => query,
      get: () =>
        Promise.resolve({
          docs: [
            notification("selected", "org-1"),
            notification("hidden", "org-2"),
          ],
        }),
    };
    const service = new ParentService({
      collection: () => query,
    } as unknown as Firestore);

    const result = await service.notifications(
      {
        uid: "parent-1",
        organizationIds: ["org-1", "org-2"],
        activeWorkspaceId: "org-1",
      },
      { limit: 20 },
    );
    expect(result.data.map((item) => item.id)).toEqual(["selected"]);
  });
});

describe("ParentService academic-support requests", () => {
  const doc = (id: string, values: Record<string, unknown>) => ({
    id,
    get: (field: string) => values[field],
  });
  const supportDb = (
    requests: ReturnType<typeof doc>[],
    links: ReturnType<typeof doc>[],
  ) =>
    ({
      collection: (name: string) => ({
        where: () => ({
          get: () =>
            Promise.resolve({
              docs: name === "supportRequests" ? requests : links,
            }),
        }),
      }),
      doc: (path: string) => ({
        get: () => {
          const id = path.split("/").at(-1);
          const found = requests.find((item) => item.id === id);
          return Promise.resolve(
            found
              ? { ...found, exists: true }
              : { id, exists: false, get: () => undefined },
          );
        },
      }),
    }) as unknown as Firestore;

  it("returns empty and populated pages scoped to an active relationship", async () => {
    const link = doc("link", {
      status: "active",
      organizationId: "org-1",
      participantId: "child-1",
    });
    await expect(
      new ParentService(supportDb([], [link])).supportList(
        { uid: "parent-1", organizationIds: ["org-1"] },
        { limit: 20 },
      ),
    ).resolves.toEqual({ data: [], meta: { nextCursor: null } });
    const request = doc("request-1", {
      requesterUid: "parent-1",
      organizationId: "org-1",
      participantId: "child-1",
      categoryId: "math",
      subject: "Fractions",
      status: "open",
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
    });
    await expect(
      new ParentService(supportDb([request], [link])).supportList(
        { uid: "parent-1", organizationIds: ["org-1"] },
        { limit: 20, status: "open" },
      ),
    ).resolves.toMatchObject({
      data: [{ id: "request-1", childId: "child-1" }],
    });
    await expect(
      new ParentService(supportDb([request], [])).supportList(
        { uid: "other-parent", organizationIds: ["org-1"] },
        { limit: 20 },
      ),
    ).resolves.toEqual({ data: [], meta: { nextCursor: null } });
  });

  it("returns not found for missing detail and another parent's request", async () => {
    const own = doc("own", {
      requesterUid: "parent-1",
      organizationId: "org-1",
    });
    const service = new ParentService(supportDb([own], []));
    await expect(
      service.supportDetail(
        { uid: "parent-1", organizationIds: ["org-1"] },
        "missing",
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.supportDetail(
        { uid: "other", organizationIds: ["org-1"] },
        "own",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("ParentService children relationship scope", () => {
  it("returns 200-compatible empty data when an authorized parent has no links", async () => {
    const query = {
      where: () => query,
      limit: () => query,
      get: () => Promise.resolve({ docs: [] }),
    };
    const service = new ParentService({
      collection: () => query,
    } as unknown as Firestore);
    await expect(
      service.children(
        { uid: "parent-1", organizationIds: ["personal-1"] },
        { limit: 20 },
      ),
    ).resolves.toEqual({ data: [], meta: { nextCursor: null } });
  });
});
