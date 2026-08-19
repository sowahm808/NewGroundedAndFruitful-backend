import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../shared/logger.js";
export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const supplied = req.header("x-request-id");
  req.requestId =
    supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
      ? supplied
      : randomUUID();
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
