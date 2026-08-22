import { createHash } from "node:crypto";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { AuthenticationError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";

export interface VerificationContext {
  requestId?: string | undefined;
  policy: string;
}

/** Verify each bearer independently. This module deliberately has no result cache. */
export async function verifyBearerToken(
  firebaseAuth: Pick<Auth, "verifyIdToken">,
  token: string,
  context: VerificationContext,
): Promise<DecodedIdToken> {
  const fingerprint = tokenFingerprint(token);
  try {
    const decoded = await firebaseAuth.verifyIdToken(token, true);
    logger.info("firebase_id_token_verified", {
      ...context,
      tokenFingerprint: fingerprint,
      claims: safeClaims(decoded),
      checkRevoked: true,
    });
    return decoded;
  } catch (error) {
    const firebaseErrorCode = providerErrorCode(error);
    logger.warn("firebase_id_token_verification_failed", {
      ...context,
      tokenFingerprint: fingerprint,
      firebaseErrorCode,
      failureReason: failureReason(firebaseErrorCode),
      claims: decodeSafeClaims(token),
      checkRevoked: true,
    });
    throw new AuthenticationError(publicFailure(firebaseErrorCode));
  }
}

export function logBearerHeaderFailure(
  requestId: string | undefined,
  reason: "missing_authorization" | "malformed_bearer_header",
  policy: string,
): void {
  logger.warn("firebase_id_token_verification_failed", {
    requestId,
    policy,
    failureReason: reason,
    authorizationPresent: reason !== "missing_authorization",
    checkRevoked: true,
  });
}

function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function decodeSafeClaims(token: string): Record<string, unknown> | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    );
    return parsed && typeof parsed === "object"
      ? safeClaims(parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function safeClaims(token: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    ["uid", "sub", "aud", "iss", "iat", "exp", "auth_time"]
      .filter((key) =>
        typeof token[key] === "number"
          ? Number.isFinite(token[key])
          : typeof token[key] === "string" && token[key].length <= 512,
      )
      .map((key) => [key, token[key]]),
  );
}

function providerErrorCode(error: unknown): string {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "unknown";
}

function failureReason(code: string): string {
  if (code === "auth/id-token-expired") return "expired_token";
  if (code === "auth/id-token-revoked") return "revoked_token";
  if (code === "auth/user-disabled") return "disabled_user";
  if (code === "auth/argument-error") return "malformed_token";
  if (code === "auth/id-token-invalid-audience")
    return "wrong_audience_or_project";
  if (code === "auth/id-token-invalid-issuer") return "wrong_issuer_or_project";
  if (code === "auth/invalid-credential") return "invalid_signature";
  return "invalid_token";
}

function publicFailure(
  code: string,
):
  | "INVALID_AUTHENTICATION_TOKEN"
  | "EXPIRED_AUTHENTICATION_TOKEN"
  | "REVOKED_AUTHENTICATION_TOKEN" {
  if (code === "auth/id-token-expired") return "EXPIRED_AUTHENTICATION_TOKEN";
  if (code === "auth/id-token-revoked") return "REVOKED_AUTHENTICATION_TOKEN";
  return "INVALID_AUTHENTICATION_TOKEN";
}
