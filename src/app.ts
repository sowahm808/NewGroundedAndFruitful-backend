import express from "express";
import helmet from "helmet";
import { rateLimit } from "./middleware/rate-limit.js";
import authRoutes from "./auth/routes/index.js";
import participantRoutes from "./participants/routes/index.js";
import pointRoutes from "./points/routes/index.js";
import { authenticate } from "./middleware/authentication.js";
import { cors } from "./middleware/cors.js";
import { requestContext } from "./middleware/request.js";
import { AppError, InternalError, NotFoundError } from "./shared/errors.js";
import { logger } from "./shared/logger.js";
import { env } from "./config/env.js";
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  requestContext,
  cors,
  helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }),
  express.json({ limit: "64kb" }),
  rateLimit(60_000, 120),
);
const healthResponse = { status: "ok", environment: env.APP_ENV } as const;

app.get("/", (_req, res) => res.json(healthResponse));
app.head("/", (_req, res) => res.sendStatus(200));
app.get("/health", (_req, res) => res.json(healthResponse));
app.get("/api/v1/health", (_req, res) => res.json(healthResponse));
if (env.NODE_ENV !== "production")
  app.get("/docs", (_req, res) =>
    res
      .type("html")
      .send(
        '<!doctype html><title>Grounded & Fruitful API</title><h1>API documentation</h1><p><a href="/openapi.yaml">OpenAPI specification</a></p>',
      ),
  );
app.get("/openapi.yaml", (_req, res) =>
  res.sendFile("openapi.yaml", { root: process.cwd() }),
);
app.use("/api/auth", authRoutes);
app.use("/api/v1/auth", authRoutes);
app.use(authenticate);
app.use("/api/v1/participants", participantRoutes);
app.use("/api/v1/points", pointRoutes);
app.use((_req, _res, next) => next(new NotFoundError()));
app.use(
  (
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const safe = error instanceof AppError ? error : new InternalError();
    logger.error("request_failed", {
      requestId: req.requestId,
      actorId: req.principal?.uid,
      route: req.path,
      status: safe.status,
      code: safe.code,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    res.status(safe.status).json({
      error: {
        code: safe.code,
        message: safe.message,
        requestId: req.requestId,
        ...(env.NODE_ENV !== "production" && safe.details
          ? { details: safe.details }
          : {}),
      },
    });
  },
);
