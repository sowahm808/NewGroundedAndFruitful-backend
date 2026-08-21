import { describe, expect, it } from "vitest";
import {
  elevationGrantSchema,
  ElevationService,
} from "../src/auth/elevations.js";
import {
  registrationIntentSchema,
  workspaceSelectionSchema,
} from "../src/auth/workspaces.js";

describe("workspace registration contracts", () => {
  it("accepts separate personal and organization intents", () => {
    expect(registrationIntentSchema.parse({ intent: "personal" })).toEqual({
      intent: "personal",
      timezone: "UTC",
    });
    expect(registrationIntentSchema.parse({ intent: "organization" })).toEqual({
      intent: "organization",
    });
  });

  it("does not accept browser roles or unvalidated workspace selection", () => {
    expect(
      registrationIntentSchema.safeParse({
        intent: "personal",
        roles: ["admin"],
      }).success,
    ).toBe(false);
    expect(
      workspaceSelectionSchema.safeParse({ workspaceId: "" }).success,
    ).toBe(false);
  });
});

describe("temporary elevation contracts", () => {
  const now = new Date("2026-08-21T00:00:00Z");
  const valid = {
    userId: "target",
    roles: [],
    capabilities: ["quarters.manage"],
    scope: { type: "workspace", workspaceId: "workspace-1" },
    reason: "Production incident response",
    startsAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    maxUses: 1,
  };

  it("requires explicit scope, reason and named authority", () => {
    expect(elevationGrantSchema.safeParse(valid).success).toBe(true);
    expect(
      elevationGrantSchema.safeParse({ ...valid, scope: {} }).success,
    ).toBe(false);
    expect(
      elevationGrantSchema.safeParse({ ...valid, roles: [], capabilities: [] })
        .success,
    ).toBe(false);
  });

  it("defines a bounded elevation lifetime", () => {
    expect(ElevationService.MAX_DURATION_MS).toBe(8 * 60 * 60 * 1000);
  });
});
