import { Router, type RequestHandler } from "express";
import { db } from "../config/firebase.js";
import { validateBody } from "../middleware/validate.js";
import { idSchema } from "../shared/validation.js";
import { ValidationError } from "../shared/errors.js";
import { ConfigurationService } from "./service.js";
import * as schemas from "./schemas.js";

const router = Router(),
  service = new ConfigurationService(db);
const run =
  (
    handler: (req: Parameters<RequestHandler>[0]) => Promise<unknown>,
    status = 200,
  ): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(status).json({ data: await handler(req) });
    } catch (error) {
      next(error);
    }
  };
const id = (value: unknown) => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new ValidationError();
  return parsed.data;
};

router.post(
  "/quarters",
  validateBody(schemas.quarterCreateSchema),
  run((req) => service.createQuarter(req.principal, req.body), 201),
);
router.post(
  "/quarters/:quarterId/transitions",
  validateBody(schemas.quarterTransitionSchema),
  run((req) =>
    service.transitionQuarter(
      req.principal,
      id(req.params.quarterId),
      req.body,
    ),
  ),
);
router.post(
  "/character-cycles",
  validateBody(schemas.characterCycleCreateSchema),
  run((req) => service.createCharacterCycle(req.principal, req.body), 201),
);
router.post(
  "/content-assignments",
  validateBody(schemas.contentAssignmentCreateSchema),
  run((req) => service.createContentAssignment(req.principal, req.body), 201),
);
router.post(
  "/point-rule-versions",
  validateBody(schemas.pointRuleVersionCreateSchema),
  run((req) => service.createPointRuleVersion(req.principal, req.body), 201),
);

export default router;
