import type { RequestHandler } from "express";
import { RateLimitError } from "../shared/errors.js";
interface Bucket {
  count: number;
  reset: number;
}
const buckets = new Map<string, Bucket>();
export function rateLimit(windowMs: number, limit: number): RequestHandler {
  return (req, res, next) => {
    const now = Date.now(),
      key = `${req.ip ?? "unknown"}:${req.path}`,
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
    if (bucket.count > limit) return next(new RateLimitError());
    next();
  };
}
