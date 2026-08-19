import { describe, expect, it, vi } from "vitest";
import { ConflictError } from "../src/shared/errors.js";
import { PointRepository } from "../src/points/repository.js";
import type { AwardRequest, PointLedgerEntry } from "../src/points/domain.js";

const request: AwardRequest = {
  participantId: "child-1",
  teamId: "team-1",
  quarterId: "quarter-1",
  sourceType: "reading",
  sourceId: "response-1",
  reason: "Reading completed",
  awardedBy: "child-1",
  idempotencyKey: "READING:child-1:response-1",
  occurredAt: new Date("2026-01-02T12:00:00Z"),
};

function repository(existing: PointLedgerEntry) {
  const transaction = {
    get: vi.fn().mockResolvedValue({ exists: true, data: () => existing }),
  };
  const db = {
    doc: vi.fn().mockReturnValue({}),
    runTransaction: vi.fn((work: (value: typeof transaction) => unknown) =>
      work(transaction),
    ),
  };
  return new PointRepository(db as never);
}

describe("point ledger idempotency", () => {
  it("returns the existing immutable award for an exact retry", async () => {
    const existing = {
      ...request,
      id: request.idempotencyKey,
      points: 10,
      createdAt: {},
    };
    await expect(repository(existing).award(request, 10)).resolves.toEqual({
      entry: existing,
      created: false,
    });
  });

  it("rejects reuse of a key for another participant instead of disclosing it", async () => {
    const existing = {
      ...request,
      participantId: "another-child",
      id: request.idempotencyKey,
      points: 10,
      createdAt: {},
    };
    await expect(
      repository(existing).award(request, 10),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
