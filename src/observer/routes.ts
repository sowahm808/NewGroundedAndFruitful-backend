import { Router, type Request, type RequestHandler } from "express";
import { db } from "../config/firebase.js";
import { requireAnyRole } from "../middleware/authorize.js";
import { ValidationError } from "../shared/errors.js";
import { idSchema } from "../shared/validation.js";
import { historyQuerySchema, observationSchema } from "./schemas.js";
import { ObserverService } from "./service.js";
const router = Router(),
  service = new ObserverService(db);
router.use(requireAnyRole("observer"));
const parse = <T>(
  s: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  v: unknown,
) => {
  const r = s.safeParse(v);
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
router.get(
  "/subjects",
  run((r) => service.subjects(r.principal!)),
);
router.post(
  "/observations",
  run(
    (r) => service.submit(r.principal!, parse(observationSchema, r.body)),
    201,
  ),
);
router.get(
  "/observations",
  run((r) => service.history(r.principal!, parse(historyQuerySchema, r.query))),
);
router.get(
  "/observations/:id/status",
  run((r) => service.status(r.principal!, parse(idSchema, r.params.id))),
);
export default router;
