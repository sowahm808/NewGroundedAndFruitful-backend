import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../shared/logger.js";
export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.requestId = req.header("x-request-id")?.slice(0, 128) ?? randomUUID();
  res.setHeader("x-request-id", req.requestId);
  const start = performance.now();
  res.on("finish", () =>
    logger.info("http_request", {
      requestId: req.requestId,
      actorId: req.principal?.uid,
      route: req.route?.path ?? req.path,
      method: req.method,
      status: res.statusCode,
      authorizationPresent: Boolean(req.header("authorization")),
      durationMs: Math.round(performance.now() - start),
    }),
  );
  next();
}
