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
    const get = () => Promise.resolve({ docs });
    const where = (field: string, operator: string, value: string) => {
      expect([field, operator, value]).toEqual(["parentUid", "==", "parent-1"]);
      return { get };
    };
    const db = {
      collection: (name: string) => {
        expect(name).toBe("characterObservations");
        return { where };
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
});
