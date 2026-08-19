import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
process.env.FIREBASE_PROJECT_ID = "demo-grounded-fruitful";
process.env.NODE_ENV = "test";
const { app } = await import("../src/app.js");
let server: Server;
let base = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test address");
      base = `http://127.0.0.1:${String(address.port)}`;
      resolve();
    });
  });
});
afterAll(
  async () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
describe("HTTP safety contract", () => {
  it("provides a minimal root health response for platform probes", async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      environment: "development",
    });
  });

  it("provides a minimal health response and request ID", async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      environment: "development",
    });
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("cross-origin-opener-policy")).toBe(
      "same-origin-allow-popups",
    );
  });
  it("requires authentication for participant resources", async () => {
    const response = await fetch(`${base}/api/v1/participants/child-a`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED", requestId: expect.any(String) },
    });
  });
  it("requires a token for auth session provisioning", async () => {
    const response = await fetch(`${base}/api/auth/session`, {
      method: "POST",
    });
    expect(response.status).toBe(401);
  });

  it("rejects malformed auth session bearer headers", async () => {
    const response = await fetch(`${base}/api/v1/auth/session`, {
      method: "POST",
      headers: { authorization: "Bearer token with spaces" },
    });
    expect(response.status).toBe(401);
  });

  it("rejects unlisted CORS origins", async () => {
    const response = await fetch(`${base}/health`, {
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });
});
