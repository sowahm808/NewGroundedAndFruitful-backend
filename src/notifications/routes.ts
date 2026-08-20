import { Router, type Request, type RequestHandler } from "express";
import { db } from "../config/firebase.js";
import { validateBody } from "../middleware/validate.js";
import { ValidationError } from "../shared/errors.js";
import { idSchema } from "../shared/validation.js";
import { enqueueNotificationSchema, preferenceSchema } from "./schemas.js";
import { NotificationService } from "./service.js";
const router = Router(),
  service = new NotificationService(db);
const id = (v: unknown) => {
  const r = idSchema.safeParse(v);
  if (!r.success) throw new ValidationError();
  return r.data;
};
const run = (fn: (req: Request) => Promise<unknown>, status = 200) =>
  (async (req, res, next) => {
    try {
      res.status(status).json({ data: await fn(req) });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler;
router.get(
  "/preferences",
  run((r) => service.preferences(r.principal, id(r.query.organizationId))),
);
router.put(
  "/preferences",
  validateBody(preferenceSchema),
  run((r) => service.setPreference(r.principal, r.body)),
);
router.post(
  "/outbox",
  validateBody(enqueueNotificationSchema),
  run((r) => service.enqueue(r.principal, r.body), 202),
);
router.get(
  "/monitoring",
  run((r) => service.monitoring(r.principal, id(r.query.organizationId))),
);
export default router;
