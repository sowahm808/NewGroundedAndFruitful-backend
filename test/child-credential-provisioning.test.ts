import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  credentialLookupDigest,
  normalizeCredentialPart,
} from "../src/auth/repositories/child-credentials.js";
import { env } from "../src/config/env.js";
import {
  generateFamilyCode,
  generatePin,
} from "../src/auth/services/child-credential-provisioning.js";
import { childLoginSchema } from "../src/auth/schemas/child-login.js";

describe("child credential primitives", () => {
  it("normalizes NFKC identifiers and computes the specified lookup HMAC", () => {
    expect(normalizeCredentialPart("  ＦAMILY  ")).toBe("family");
    const expected = createHmac("sha256", env.CHILD_LOGIN_LOOKUP_SECRET)
      .update("family\nsprout")
      .digest("hex");
    expect(credentialLookupDigest(" ＦAMILY ", " SPROUT ")).toBe(expected);
  });
  it("generates conservative family codes and cryptographic six digit PINs", () => {
    expect(generateFamilyCode()).toMatch(/^[a-z0-9_-]{8,24}$/);
    expect(generatePin()).toMatch(/^\d{6}$/);
  });
  it("accepts workspace codes and four-to-six digit PINs at login", () => {
    const base = {
      familyCode: "personal-0846ff3425782ab7e88542cf",
      handle: "sprout",
    };
    for (const pin of ["1234", "12345", "123456"]) {
      expect(childLoginSchema.safeParse({ ...base, pin }).success).toBe(true);
    }
    expect(childLoginSchema.safeParse({ ...base, pin: "123" }).success).toBe(
      false,
    );
    expect(
      childLoginSchema.safeParse({ ...base, pin: "1234567" }).success,
    ).toBe(false);
    expect(childLoginSchema.safeParse({ ...base, pin: "12345a" }).success).toBe(
      false,
    );
  });
});
