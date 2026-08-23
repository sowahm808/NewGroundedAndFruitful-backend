import { Router, type RequestHandler } from "express";

import {
  OrganizationBootstrapService,
  PersonalWorkspaceBootstrapService,
  LegacyOrganizationRepairService,
} from "./service.js";
import {
  organizationBootstrapSchema,
  personalWorkspaceBootstrapSchema,
  legacyOrganizationRepairSchema,
} from "./schemas.js";
import { requireAuthenticated } from "../auth/authorization.js";
import { auth, db } from "../config/firebase.js";
import { validateBody } from "../middleware/validate.js";

const router = Router();
const service = new OrganizationBootstrapService(db);
const personalWorkspaceService = new PersonalWorkspaceBootstrapService(db);
const repairService = new LegacyOrganizationRepairService(db, auth);

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
  ["/personal-workspace", "/personal"],
  validateBody(personalWorkspaceBootstrapSchema),
  run(async (req, res) => {
    const actor = requireAuthenticated(req.principal);
    const result = await personalWorkspaceService.bootstrap({
      uid: actor.uid,
      requestId: req.requestId,
      timezone: req.body.timezone,
    });
    res.status(201).json({ data: result });
  }),
);

router.post(
  "/organization",
  validateBody(organizationBootstrapSchema),
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

router.post(
  "/organization/repair",
  validateBody(legacyOrganizationRepairSchema),
  run(async (req, res) => {
    const actor = requireAuthenticated(req.principal);
    const result = await repairService.repair({
      actorUid: actor.uid,
      targetUid: req.body.targetUid ?? actor.uid,
      requestId: req.requestId,
    });
    res.json({ data: result });
  }),
);

export default router;
