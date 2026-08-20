import { Router, type RequestHandler } from "express";

import { bootstrapLegacyAdministrator } from "../admin/provisioning.js";
import { organizationCreateSchema } from "../administration/schemas.js";
import { requireAuthenticated } from "../auth/authorization.js";
import { auth, db } from "../config/firebase.js";
import { validateBody } from "../middleware/validate.js";

const router = Router();

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
    const result = await bootstrapLegacyAdministrator(auth, db, {
      uid: actor.uid,
      actor: actor.uid,
      requestId: req.requestId,
      name: req.body.name,
      slug: req.body.slug,
      timezone: req.body.timezone,
    });

    res.status(201).json({ data: result });
  }),
);

export default router;
