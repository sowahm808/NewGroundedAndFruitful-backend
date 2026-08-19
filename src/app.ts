import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";

import authRoutes from "./auth/routes/index.js";
import participantRoutes from "./participants/routes/index.js";
import pointRoutes from "./points/routes/index.js";
import parentRoutes from "./parent/routes/index.js";
import childRoutes from "./child/routes/index.js";
import { env } from "./config/env.js";
import { authenticate } from "./middleware/authentication.js";
import { cors } from "./middleware/cors.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { requestContext } from "./middleware/request.js";
import { privateResponse } from "./middleware/private-response.js";
import {
  AppError,
  InternalError,
  NotFoundError,
  RateLimitError,
} from "./shared/errors.js";
import { logger } from "./shared/logger.js";

export const app = express();

app.disable("x-powered-by");

/*
 * Keep this only when production runs behind exactly one trusted reverse proxy,
 * such as Render. Otherwise, make the proxy configuration environment-driven.
 */
app.set("trust proxy", 1);

app.use(requestContext);
app.use(cors);

app.use(
  helmet({
    crossOriginOpenerPolicy: {
      policy: "same-origin-allow-popups",
    },
  }),
);

app.use(express.json({ limit: "64kb" }));

const healthResponse = {
  status: "ok",
  environment: env.NODE_ENV,
} as const;

/*
 * Health endpoints should not be rate-limited or authenticated because hosting
 * platforms and load balancers call them frequently.
 */
app.head("/", (_req, res) => {
  res.sendStatus(200);
});

app.get("/", (_req, res) => {
  res.status(200).json(healthResponse);
});

app.get("/health", (_req, res) => {
  res.status(200).json(healthResponse);
});

app.get("/api/v1/health", (_req, res) => {
  res.status(200).json(healthResponse);
});

/*
 * Do not expose internal API documentation in production unless it is
 * intentionally protected.
 */
if (env.NODE_ENV !== "production") {
  app.get("/docs", (_req, res) => {
    res.status(200).type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Grounded &amp; Fruitful API</title>
  </head>
  <body>
    <main>
      <h1>API documentation</h1>
      <p><a href="/openapi.yaml">OpenAPI specification</a></p>
    </main>
  </body>
</html>`);
  });

  app.get("/openapi.yaml", (_req, res, next) => {
    res.sendFile("openapi.yaml", { root: process.cwd() }, (error) => {
      if (error) {
        next(error);
      }
    });
  });
}

/*
 * Apply general API rate limiting after health endpoints.
 * Authentication endpoints should eventually use a stricter limiter.
 */
app.use(rateLimit(60_000, 120));

/*
 * Preserve the legacy route temporarily if the frontend still uses it.
 * Remove it after consumers migrate to /api/v1/auth.
 */
app.use("/api/auth", privateResponse, authRoutes);
app.use("/api/v1/auth", privateResponse, authRoutes);

/*
 * Attach authentication only to protected routers. A global authenticate
 * middleware would make unknown routes return 401 instead of 404.
 */
app.use(
  "/api/v1/participants",
  privateResponse,
  authenticate,
  participantRoutes,
);
app.use("/api/v1/points", privateResponse, authenticate, pointRoutes);
app.use("/api/v1/parent", privateResponse, authenticate, parentRoutes);
app.use("/api/v1/child", privateResponse, authenticate, childRoutes);

app.use((_req, _res, next) => {
  next(new NotFoundError());
});

/*
 * Express recognizes an error handler by its four parameters. Do not remove
 * _next even though it is only used for the headers-sent case.
 */
app.use(
  (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const safeError = error instanceof AppError ? error : new InternalError();

    const logContext = {
      requestId: req.requestId,
      actorId: req.principal?.uid,
      method: req.method,
      route: req.originalUrl,
      status: safeError.status,
      code: safeError.code,
      errorType: error instanceof Error ? error.name : "unknown",
      ...(env.NODE_ENV !== "production" && error instanceof Error
        ? { stack: error.stack }
        : {}),
    };

    if (safeError.status >= 500) {
      logger.error("request_failed", logContext);
    } else {
      logger.warn("request_rejected", logContext);
    }

    if (safeError instanceof RateLimitError)
      res.setHeader("retry-after", String(safeError.retryAfterSeconds));
    const body = {
      code: safeError.code.toLowerCase(),
      message: safeError.status === 401 ? "Sign-in failed" : safeError.message,
      requestId: req.requestId,
      ...(safeError.details ? { details: safeError.details } : {}),
    };
    const fieldErrors =
      safeError.details &&
      typeof safeError.details === "object" &&
      "fieldErrors" in safeError.details
        ? { fieldErrors: safeError.details.fieldErrors }
        : {};
    // Keep the old nested member during the version-one envelope migration.
    res.status(safeError.status).json({
      ...body,
      error: { ...body, code: safeError.code, ...fieldErrors },
    });
  },
);
