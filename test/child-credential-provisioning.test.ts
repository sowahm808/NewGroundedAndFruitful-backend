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
});
