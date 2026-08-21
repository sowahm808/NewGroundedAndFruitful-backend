import type { Bucket } from "@google-cloud/storage";
import { env } from "./env.js";
import { storage } from "./firebase.js";
import { logger } from "../shared/logger.js";

export type StorageReadiness =
  | { status: "checking" }
  | { status: "ready" }
  | {
      status: "unavailable";
      reason: "not_configured" | "permission_denied" | "unavailable";
    };

let state: StorageReadiness = env.FIREBASE_STORAGE_BUCKET
  ? { status: "checking" }
  : { status: "unavailable", reason: "not_configured" };

export const importBucket = env.FIREBASE_STORAGE_BUCKET
  ? storage.bucket()
  : undefined;

const providerCode = (cause: unknown) => {
  if (!cause || typeof cause !== "object") return undefined;
  const value = (cause as { code?: unknown }).code;
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
};

export async function initializeStorageReadiness(
  bucket: Pick<Bucket, "getMetadata"> | undefined = importBucket,
) {
  if (!bucket) {
    state = { status: "unavailable", reason: "not_configured" };
    return state;
  }
  try {
    await bucket.getMetadata();
    state = { status: "ready" };
    logger.info("bible_import_storage_ready");
  } catch (cause) {
    const code = providerCode(cause);
    const denied = code === "401" || code === "403";
    state = {
      status: "unavailable",
      reason: denied ? "permission_denied" : "unavailable",
    };
    logger.error("bible_import_storage_probe_failed", {
      phase: "bucket_metadata",
      safeProviderCode: code,
      errorType: cause instanceof Error ? cause.name : "unknown",
    });
  }
  return state;
}

export const storageReadiness = () => state;
