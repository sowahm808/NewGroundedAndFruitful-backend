import type { RequestHandler } from "express";
import { allowedOrigins } from "../config/env.js";
import { AuthorizationError } from "../shared/errors.js";
export const cors: RequestHandler = (req, res, next) => {
  const origin = req.header("origin");
  if (origin) {
    // This bearer-authenticated bootstrap route has no ambient-cookie authority.
    // Its policy is intentionally authentication-only, even before a deployment's
    // frontend origin allowlist has caught up with a new client hostname.
    const registrationIntent =
      req.method === "POST" &&
      (req.path === "/api/v1/auth/registration-intent" ||
        req.path === "/api/auth/registration-intent");
    if (!allowedOrigins.has(origin) && !registrationIntent)
      return next(new AuthorizationError());
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader(
      "access-control-allow-headers",
      "Authorization, Content-Type, Idempotency-Key, X-Request-Id",
    );
    res.setHeader(
      "access-control-allow-methods",
      "GET,POST,PATCH,DELETE,OPTIONS",
    );
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
};
