import { Router, type RequestHandler } from "express";

import { OrganizationBootstrapService } from "./service.js";
import { organizationCreateSchema } from "../administration/schemas.js";
import { requireAuthenticated } from "../auth/authorization.js";
import { db } from "../config/firebase.js";
import { validateBody } from "../middleware/validate.js";

const router = Router();
const service = new OrganizationBootstrapService(db);

const run =
  (handler: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };

router.post(
  "/organization",
  validateBody(organizationCreateSchema),
  run(async (req, res) => {
    const actor = requireAuthenticated(req.principal);
    const idempotencyKey = req.header("idempotency-key")?.trim();
    const result = await service.bootstrap({
      uid: actor.uid,
      requestId: req.requestId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      name: req.body.name,
      slug: req.body.slug,
      timezone: req.body.timezone,
    });

    res.status(201).json({ data: result });
  }),
);

export default router;
