import { describe, expect, it } from "vitest";
import {
  consentCaptureSchema,
  invitationCreateSchema,
  participantCreateSchema,
  participantListQuerySchema,
  resourceListQuerySchema,
  roleListQuerySchema,
  roleUpdateSchema,
} from "../src/administration/schemas.js";

describe("administration request contracts", () => {
  it("accepts the frontend resource list pagination contract", () => {
    expect(
      resourceListQuerySchema.parse({
        page: "1",
        pageSize: "25",
        sort: "-updatedAt",
      }),
    ).toEqual({ page: 1, pageSize: 25, sort: "-updatedAt" });
    expect(
      resourceListQuerySchema.safeParse({ page: "0", pageSize: "101" }).success,
    ).toBe(false);
  });

  it("requires a guardian and a valid birth date when creating participants", () => {
    expect(
      participantCreateSchema.safeParse({
        organizationId: "org-1",
        programId: "program-1",
        displayName: "Child",
        birthDate: "2020-01-01",
      }).success,
    ).toBe(false);
    expect(
      participantCreateSchema.safeParse({
        organizationId: "org-1",
        programId: "program-1",
        displayName: "Child",
        birthDate: "2020-01-01",
        guardianUserId: "guardian-1",
      }).success,
    ).toBe(true);
  });

  it("only captures affirmative, explicitly versioned consent", () => {
    const base = {
      organizationId: "org-1",
      participantId: "child-1",
      policyKey: "participation",
      policyVersion: "2026-08",
      legalTextReference: "https://legal.example/participation/2026-08",
    };
    expect(
      consentCaptureSchema.safeParse({ ...base, granted: false }).success,
    ).toBe(false);
    expect(
      consentCaptureSchema.safeParse({ ...base, granted: true }).success,
    ).toBe(true);
  });

  it("limits invitations and membership updates to canonical values", () => {
    expect(
      invitationCreateSchema.safeParse({
        organizationId: "org-1",
        email: "adult@example.com",
        role: "admin",
        expiresAt: "2030-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      roleUpdateSchema.safeParse({ role: "mentor", status: "suspended" })
        .success,
    ).toBe(true);
  });
});

describe("administration list query schemas", () => {
  it("rejects invalid participant query values with field-level schema errors", () => {
    const result = participantListQuerySchema.safeParse({
      page: "0",
      pageSize: "101",
      sort: "name",
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.flatten().fieldErrors).toMatchObject({
        page: expect.any(Array),
        pageSize: expect.any(Array),
        sort: expect.any(Array),
      });
  });
  it("accepts the frontend roles pagination query without an organization", () => {
    expect(
      roleListQuerySchema.parse({
        page: "1",
        pageSize: "25",
        sort: "-updatedAt",
      }),
    ).toEqual({ page: 1, pageSize: 25, sort: "-updatedAt" });
  });

  it("continues to reject unsupported roles query parameters", () => {
    expect(
      roleListQuerySchema.safeParse({ page: "1", unsupported: "value" })
        .success,
    ).toBe(false);
  });
});
