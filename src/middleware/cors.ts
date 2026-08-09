import type { RequestHandler } from "express";
import { allowedOrigins } from "../config/env.js";
import { AuthorizationError } from "../shared/errors.js";
export const cors: RequestHandler = (req, res, next) => {
  const origin = req.header("origin");
  if (origin) {
    if (!allowedOrigins.has(origin)) return next(new AuthorizationError());
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
