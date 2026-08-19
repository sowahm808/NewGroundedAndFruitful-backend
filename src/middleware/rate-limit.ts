import type { RequestHandler } from "express";
import { createHmac } from "node:crypto";
import { env } from "../config/env.js";
import { RateLimitError } from "../shared/errors.js";
interface Bucket {
  count: number;
  reset: number;
}
const buckets = new Map<string, Bucket>();
export function rateLimit(
  windowMs: number,
  limit: number,
  keyForRequest?: (request: Parameters<RequestHandler>[0]) => string,
): RequestHandler {
  return (req, res, next) => {
    const now = Date.now(),
      key = keyForRequest?.(req) ?? `${req.ip ?? "unknown"}:${req.path}`,
      old = buckets.get(key),
      bucket =
        !old || old.reset <= now
          ? { count: 1, reset: now + windowMs }
          : { count: old.count + 1, reset: old.reset };
    buckets.set(key, bucket);
    res.setHeader("ratelimit-limit", String(limit));
    res.setHeader(
      "ratelimit-remaining",
      String(Math.max(0, limit - bucket.count)),
    );
    res.setHeader("ratelimit-reset", String(Math.ceil(bucket.reset / 1000)));
    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.reset - now) / 1000));
      res.setHeader("retry-after", String(retryAfter));
      return next(new RateLimitError(retryAfter));
    }
    next();
  };
}

/** Hashes the network and normalized identifiers so limiter keys contain no credentials. */
export const childCredentialRateLimit = (windowMs: number, limit: number) =>
  rateLimit(windowMs, limit, (request) => {
    const body = request.body as Record<string, unknown> | undefined;
    const familyCode = normalize(body?.familyCode);
    const handle = normalize(body?.handle);
    return createHmac("sha256", env.CHILD_LOGIN_PEPPER)
      .update(`${request.ip ?? "unknown"}\0${familyCode}\0${handle}`)
      .digest("base64url");
  });

const normalize = (value: unknown) =>
  typeof value === "string"
    ? value.normalize("NFKC").trim().toLocaleLowerCase("en-US")
    : "";
