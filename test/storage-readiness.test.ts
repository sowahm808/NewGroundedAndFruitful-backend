import { describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.APP_ENV = "development";
process.env.FIREBASE_PROJECT_ID = "demo-grounded-fruitful";

const { firebaseEnvSchema } = await import("../src/config/env.js");
const { initializeStorageReadiness } =
  await import("../src/config/storage-readiness.js");

describe("Bible import storage configuration", () => {
  it("accepts the exact modern Firebase bucket format", () => {
    const parsed = firebaseEnvSchema.safeParse({
      ...process.env,
      FIREBASE_STORAGE_BUCKET: "grounded-fruitful.firebasestorage.app",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(parsed.data.FIREBASE_STORAGE_BUCKET).toBe(
        "grounded-fruitful.firebasestorage.app",
      );
  });

  it.each([
    "https://project.firebasestorage.app",
    "project.firebasestorage.app/path",
    "../project.firebasestorage.app",
  ])("rejects a bucket URL or unsafe bucket name: %s", (bucket) => {
    expect(
      firebaseEnvSchema.safeParse({
        ...process.env,
        FIREBASE_STORAGE_BUCKET: bucket,
      }).success,
    ).toBe(false);
  });

  it("fails the production environment when the bucket is missing", () => {
    const old = process.env.FIREBASE_STORAGE_BUCKET;
    delete process.env.FIREBASE_STORAGE_BUCKET;
    const parsed = firebaseEnvSchema.safeParse({
      ...process.env,
      APP_ENV: "production",
      FIREBASE_CLIENT_EMAIL: "service@example.test",
      FIREBASE_PRIVATE_KEY: "private-key-placeholder",
      ALLOWED_ORIGINS: "https://groundedandfruitful.org",
      CHILD_LOGIN_PEPPER: "a-unique-secret-at-least-16",
      CHILD_LOGIN_LOOKUP_SECRET: "another-secret-at-least-16",
    });
    if (old) process.env.FIREBASE_STORAGE_BUCKET = old;
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(
        "FIREBASE_STORAGE_BUCKET is required in production.",
      );
  });

  it("marks storage ready after the controlled metadata probe", async () => {
    const getMetadata = vi.fn().mockResolvedValue([{}]);
    await expect(initializeStorageReadiness({ getMetadata })).resolves.toEqual({
      status: "ready",
    });
    expect(getMetadata).toHaveBeenCalledOnce();
  });

  it("maps an inaccessible bucket to unavailable readiness without exposing it", async () => {
    const getMetadata = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("bucket does not exist"), { code: 404 }),
      );
    await expect(initializeStorageReadiness({ getMetadata })).resolves.toEqual({
      status: "unavailable",
      reason: "unavailable",
    });
  });

  it("distinguishes an IAM denial during readiness", async () => {
    const getMetadata = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("denied"), { code: 403 }));
    await expect(initializeStorageReadiness({ getMetadata })).resolves.toEqual({
      status: "unavailable",
      reason: "permission_denied",
    });
  });
});
