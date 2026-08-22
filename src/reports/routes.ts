import { Router, type Request, type RequestHandler } from "express";
import { db, storage } from "../config/firebase.js";
import { env } from "../config/env.js";
import { validateBody } from "../middleware/validate.js";
import { ValidationError } from "../shared/errors.js";
import { idSchema } from "../shared/validation.js";
import {
  reportActionSchema,
  reportDefinitionListQuerySchema,
  reportJobListQuerySchema,
  reportRequestSchema,
} from "./schemas.js";
import { ReportService } from "./service.js";
const router = Router(),
  service = env.FIREBASE_STORAGE_BUCKET
    ? new ReportService(db, storage.bucket(env.FIREBASE_STORAGE_BUCKET))
    : new ReportService(db);
const id = (v: unknown) => {
  const r = idSchema.safeParse(v);
  if (!r.success) throw new ValidationError();
  return r.data;
};
const run = (fn: (r: Request) => Promise<unknown>, status = 200) =>
  (async (req, res, next) => {
    try {
      res.status(status).json({ data: await fn(req) });
    } catch (e) {
      next(e);
    }
  }) satisfies RequestHandler;
const query = <T>(
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { flatten(): { fieldErrors: unknown } } };
  },
  value: unknown,
): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ValidationError("Invalid report query.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  return parsed.data;
};
router.get(
  "/definitions",
  run((r) =>
    service.definitions(
      r.principal,
      query(reportDefinitionListQuerySchema, r.query),
    ),
  ),
);
router.get(
  "/jobs",
  run((r) =>
    service.jobs(r.principal, query(reportJobListQuerySchema, r.query)),
  ),
);
router.post(
  "/jobs",
  validateBody(reportRequestSchema),
  run((r) => service.request(r.principal, r.body), 202),
);
router.get(
  "/jobs/:reportId",
  run((r) => service.status(r.principal, id(r.params.reportId))),
);
router.post(
  "/jobs/:reportId/download",
  run((r) => service.download(r.principal, id(r.params.reportId))),
);
router.post(
  "/jobs/:reportId/retry",
  validateBody(reportActionSchema),
  run((r) =>
    service.retry(r.principal, id(r.params.reportId), r.body.organizationId),
  ),
);
router.post(
  "/jobs/:reportId/cancel",
  validateBody(reportActionSchema),
  run((r) =>
    service.cancel(r.principal, id(r.params.reportId), r.body.organizationId),
  ),
);
router.post(
  "/",
  validateBody(reportRequestSchema),
  run((r) => service.request(r.principal, r.body), 202),
);
router.get(
  "/:reportId",
  run((r) => service.status(r.principal, id(r.params.reportId))),
);
router.post(
  "/:reportId/download",
  run((r) => service.download(r.principal, id(r.params.reportId))),
);
export default router;
