import { Router } from "express";
import { childCredentialRateLimit } from "../../middleware/rate-limit.js";
import { auth, db } from "../../config/firebase.js";
import { validateBody } from "../../middleware/validate.js";
import { AuditRepository } from "../../audit/repository.js";
import { ChildLoginController } from "../controllers/child-login.js";
import { AuthSessionController } from "../controllers/session.js";
import { ChildCredentialRepository } from "../repositories/child-credentials.js";
import { UserRepository } from "../repositories/users.js";
import { MembershipRepository } from "../repositories/memberships.js";
import { childLoginSchema } from "../schemas/child-login.js";
import { ChildLoginService } from "../services/child-login.js";
import { AuthSessionService } from "../services/session.js";

const router = Router();
const sessionController = new AuthSessionController(
  new AuthSessionService(
    auth,
    new UserRepository(db),
    new MembershipRepository(db),
  ),
);
const controller = new ChildLoginController(
  new ChildLoginService(
    new ChildCredentialRepository(db),
    new AuditRepository(db),
    auth,
  ),
);

router.post(
  "/session",
  (req, res, next) => void sessionController.create(req, res).catch(next),
);
router.get(
  "/session",
  (req, res, next) => void sessionController.create(req, res).catch(next),
);

router.post(
  "/child-token",
  validateBody(childLoginSchema),
  childCredentialRateLimit(db, 15 * 60_000, 10),
  (req, res, next) => void controller.login(req, res).catch(next),
);

export default router;
