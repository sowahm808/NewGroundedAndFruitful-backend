import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
process.env.FIREBASE_PROJECT_ID = "demo-grounded-fruitful";
process.env.NODE_ENV = "test";
const { app } = await import("../src/app.js");
const { default: parentRouter } = await import("../src/parent/routes/index.js");
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
  it("registers the academic-support configuration contract", () => {
    const configurationRoute = parentRouter.stack.find(
      (layer) => layer.route?.path === "/academic-support/configuration",
    );

    expect(configurationRoute?.route?.path).toBe(
      "/academic-support/configuration",
    );
  });
  it("registers the exact academic-support routes in static-first order", () => {
    const routes = parentRouter.stack
      .map((layer) => layer.route)
      .filter((route) => String(route?.path).startsWith("/academic-support"))
      .map((route) => ({
        path: route?.path,
        methods: (route as unknown as { methods?: Record<string, boolean> })
          .methods,
      }));
    expect(routes).toEqual([
      {
        path: "/academic-support/configuration",
        methods: { get: true },
      },
      { path: "/academic-support/requests", methods: { get: true } },
      { path: "/academic-support/requests", methods: { post: true } },
      {
        path: "/academic-support/requests/:requestId",
        methods: { get: true },
      },
    ]);
  });

  it("provides a minimal root health response for platform probes", async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      environment: "test",
      revision: "unknown",
    });
  });

  it("provides a minimal health response and request ID", async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      environment: "test",
      revision: "unknown",
    });
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("cross-origin-opener-policy")).toBe(
      "same-origin-allow-popups",
    );
  });
  it("publishes the child router rather than returning 404", async () => {
    const response = await fetch(`${base}/api/v1/child/today`);
    expect(response.status).toBe(401);
    expect(response.status).not.toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });
  it("requires authentication for every parent workflow", async () => {
    for (const path of [
      "dashboard",
      "notifications",
      "children",
      "observations",
      "academic-support/configuration",
      "academic-support/requests?cursor=&status=&search=&childId=",
      "support/categories",
    ]) {
      const response = await fetch(`${base}/api/v1/parent/${path}`);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "AUTHENTICATION_REQUIRED" },
      });
    }
  });
  it("requires authentication for participant resources", async () => {
    const response = await fetch(`${base}/api/v1/participants/child-a`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED", requestId: expect.any(String) },
    });
  });
  it("protects the organization administration API", async () => {
    const response = await fetch(
      `${base}/api/v1/administration/participants?organizationId=org-1`,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
  it("accepts the frontend admin participant list query contract", async () => {
    const response = await fetch(
      `${base}/api/v1/admin/participants?page=1&pageSize=25&sort=updatedAt_desc`,
    );
    expect(response.status).toBe(401);
    expect(response.status).not.toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
  it("publishes the frontend admin users route rather than returning 404", async () => {
    const response = await fetch(
      `${base}/api/v1/admin/users?page=1&pageSize=25&sort=-updatedAt`,
    );
    expect(response.status).toBe(401);
    expect(response.status).not.toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
  it("publishes the nested Bible content import route", async () => {
    const response = await fetch(`${base}/api/v1/admin/bible-content/imports`, {
      method: "POST",
    });
    expect(response.status).toBe(415);
    expect(response.status).not.toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "BIBLE_IMPORT_FILE_INVALID" },
    });
  });
  it("parses the documented Bible import text and file part names", async () => {
    const form = new FormData();
    form.set("organizationId", "org-1");
    form.set("quarterId", "quarter-1");
    form.set("title", "Quarter 1 Bible Quiz");
    const docxType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    form.set(
      "quizFile",
      new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
        type: docxType,
      }),
      "quiz.docx",
    );
    form.set(
      "answerKeyFile",
      new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
        type: docxType,
      }),
      "answers.docx",
    );
    const response = await fetch(`${base}/api/v1/admin/bible-content/imports`, {
      method: "POST",
      body: form,
    });
    // Passing multipart validation reaches the established authorization gate.
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
  it("returns fieldErrors for missing multipart import parts", async () => {
    const form = new FormData();
    form.set("organizationId", "org-1");
    form.set("title", "Quarter 1 Bible Quiz");
    const response = await fetch(`${base}/api/v1/admin/bible-content/imports`, {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        fieldErrors: {
          quarterId: expect.any(Array),
          quizFile: ["quizFile is required."],
          answerKeyFile: ["answerKeyFile is required."],
        },
      },
    });
  });
  it("publishes the authenticated organization onboarding route", async () => {
    const response = await fetch(`${base}/api/v1/onboarding/organization`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Grounded & Fruitful",
        slug: "grounded-fruitful",
        timezone: "UTC",
      }),
    });
    expect(response.status).toBe(401);
    expect(response.status).not.toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
  it("publishes the frontend personal onboarding route", async () => {
    const response = await fetch(`${base}/api/v1/onboarding/personal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: "UTC" }),
    });
    expect(response.status).toBe(401);
    expect(response.status).not.toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
  it("publishes the frontend admin memberships route rather than returning 404", async () => {
    const response = await fetch(
      `${base}/api/v1/admin/memberships?page=1&pageSize=25&sort=-updatedAt`,
    );
    expect(response.status).toBe(401);
    expect(response.status).not.toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
  it("publishes the paginated frontend admin roles route rather than returning 422", async () => {
    const response = await fetch(
      `${base}/api/v1/admin/roles?page=1&pageSize=25&sort=-updatedAt`,
    );
    expect(response.status).toBe(401);
    expect(response.status).not.toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
  it("requires a token for auth session provisioning", async () => {
    const response = await fetch(`${base}/api/auth/session`, {
      method: "POST",
    });
    expect(response.status).toBe(401);
  });
  it("publishes the registration-intent compatibility route", async () => {
    const response = await fetch(`${base}/api/v1/auth/registration-intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "organization" }),
    });
    expect(response.status).toBe(401);
    expect(response.status).not.toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
  it("does not let the application-level origin guard intercept registration intent", async () => {
    const response = await fetch(`${base}/api/v1/auth/registration-intent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://new-registration-client.example",
      },
      body: JSON.stringify({ intent: "organization" }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
  it("requires a token for GET session bootstrap", async () => {
    const response = await fetch(`${base}/api/v1/auth/session`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
  it("does not turn a conditional private response into a bodyless 304", async () => {
    const first = await fetch(`${base}/api/v1/parent/children`);
    const response = await fetch(`${base}/api/v1/parent/children`, {
      headers: { "if-none-match": first.headers.get("etag") ?? '"private"' },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.text()).length).toBeGreaterThan(0);
  });
  it("publishes the anonymous child-token request contract", async () => {
    const response = await fetch(`${base}/api/v1/auth/child-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familyCode: "abcd",
        handle: "kid",
        password: "secret",
      }),
    });
    expect(response.status).toBe(422);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(await response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        requestId: expect.any(String),
        fieldErrors: { pin: expect.any(Array) },
      },
    });
  });
  it("returns 404 rather than authenticating unknown routes", async () => {
    const response = await fetch(`${base}/api/v1/not-a-route`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("rejects malformed auth session bearer headers", async () => {
    const response = await fetch(`${base}/api/v1/auth/session`, {
      method: "POST",
      headers: { authorization: "Bearer token with spaces" },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_AUTHENTICATION_TOKEN" },
    });
  });

  it("requires an authorization token before entering protected admin routes", async () => {
    const response = await fetch(`${base}/api/v1/admin/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: "org-1", name: "Team One" }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  it.each([
    "https://groundedandfruitful.netlify.app",
    "https://groundedandfruitful.org",
    "https://www.groundedandfruitful.org",
  ])(
    "permits production CORS preflight from %s when configured",
    async (origin) => {
      // The test process uses the default local allowlist, so mutate the exported
      // set rather than weakening the production exact-match behavior.
      const { allowedOrigins } = await import("../src/config/env.js");
      allowedOrigins.add(origin);
      const response = await fetch(`${base}/api/v1/auth/session`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization,content-type",
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("vary")).toContain("Origin");
      expect(response.headers.get("access-control-allow-headers")).toContain(
        "Authorization",
      );
      expect(response.headers.get("access-control-allow-methods")).toContain(
        "PUT",
      );
    },
  );

  it("rejects unlisted CORS origins", async () => {
    const response = await fetch(`${base}/health`, {
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });
});
