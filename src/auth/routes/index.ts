import { Router } from "express";
import { rateLimit } from "../../middleware/rate-limit.js";
import { auth, db } from "../../config/firebase.js";
import { validateBody } from "../../middleware/validate.js";
import { AuditRepository } from "../../audit/repository.js";
import { ChildLoginController } from "../controllers/child-login.js";
import { ChildCredentialRepository } from "../repositories/child-credentials.js";
import { childLoginSchema } from "../schemas/child-login.js";
import { ChildLoginService } from "../services/child-login.js";
const router = Router();
const controller = new ChildLoginController(
  new ChildLoginService(
    new ChildCredentialRepository(db),
    new AuditRepository(db),
    auth,
  ),
);
router.post(
  "/child-login",
  rateLimit(15 * 60_000, 10),
  validateBody(childLoginSchema),
  (req, res, next) => void controller.login(req, res).catch(next),
);
export default router;
