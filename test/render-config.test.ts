import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Render production configuration", () => {
  it.each([
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "FIREBASE_STORAGE_BUCKET",
    "ALLOWED_ORIGINS",
    "CHILD_LOGIN_PEPPER",
    "CHILD_LOGIN_LOOKUP_SECRET",
  ])("declares the required %s variable", (name) => {
    const blueprint = readFileSync(
      new URL("../render.yaml", import.meta.url),
      "utf8",
    );

    expect(blueprint).toMatch(new RegExp(`^\\s+- key: ${name}$`, "m"));
  });
});
