import { describe, expect, it } from "vitest";
import {
  characterQuerySchema,
  characterSelectionSchema,
  childCredentialsSchema,
  childQuerySchema,
  observationSchema,
  observationQuerySchema,
  supportListQuerySchema,
  supportRequestSchema,
} from "../src/parent/schemas.js";

describe("parent API validation", () => {
  it("validates pagination, status, and bounded search", () => {
    expect(
      childQuerySchema.parse({
        limit: "10",
        status: "active",
        search: " Ada ",
      }),
    ).toEqual({ limit: 10, status: "active", search: "Ada" });
    expect(childQuerySchema.safeParse({ status: "all" }).success).toBe(false);
    expect(childQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
  });
  it("treats empty query parameters as omitted", () => {
    expect(
      childQuerySchema.parse({
        limit: "",
        cursor: "",
        status: "",
        search: "",
      }),
    ).toEqual({
      limit: 20,
      cursor: undefined,
      status: undefined,
      search: undefined,
    });
  });
  it("normalizes only optional observation and support query strings", () => {
    expect(observationQuerySchema.parse({ cursor: "", childId: "" })).toEqual({
      limit: 20,
      cursor: undefined,
      childId: undefined,
    });
    expect(
      supportListQuerySchema.parse({
        cursor: "",
        childId: "",
        status: "",
        search: "",
      }),
    ).toEqual({
      limit: 20,
      cursor: undefined,
      childId: undefined,
      status: undefined,
      search: undefined,
    });
    expect(
      supportListQuerySchema.safeParse({ cursor: "bad cursor!" }).success,
    ).toBe(false);
    expect(
      supportListQuerySchema.safeParse({ status: "pending" }).success,
    ).toBe(false);
  });
  it("requires exactly three distinct configured quality IDs", () => {
    expect(
      characterSelectionSchema.safeParse({
        childId: "c1",
        quarterId: "q1",
        qualityIds: ["a", "b", "c"],
      }).success,
    ).toBe(true);
    expect(
      characterSelectionSchema.safeParse({
        childId: "c1",
        quarterId: "q1",
        qualityIds: ["a", "a", "c"],
      }).success,
    ).toBe(false);
  });
  it("allows character selection queries to use the active quarter", () => {
    expect(characterQuerySchema.parse({ childId: "c1" })).toEqual({
      childId: "c1",
    });
    expect(
      characterQuerySchema.parse({ childId: "c1", quarterId: "" }),
    ).toEqual({ childId: "c1", quarterId: undefined });
    expect(
      characterQuerySchema.safeParse({ childId: "c1", quarterId: "bad id!" })
        .success,
    ).toBe(false);
  });
  it("accepts only four-to-six digit child PINs", () => {
    expect(
      childCredentialsSchema.parse({ handle: " James Lee ", pin: "1234" }),
    ).toEqual({ handle: "James Lee", pin: "1234" });
    expect(childCredentialsSchema.safeParse({ pin: "123456" }).success).toBe(
      true,
    );
    expect(childCredentialsSchema.safeParse({ pin: "123" }).success).toBe(
      false,
    );
    expect(childCredentialsSchema.safeParse({ pin: "12a4" }).success).toBe(
      false,
    );
  });
  it("enforces constructive observation and support text limits", () => {
    expect(
      observationSchema.safeParse({
        childId: "c1",
        description: "too short",
        observedAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
    expect(
      supportRequestSchema.safeParse({
        childId: "c1",
        categoryId: "cat",
        subject: "Help",
        description: "too short",
      }).success,
    ).toBe(false);
  });
});
