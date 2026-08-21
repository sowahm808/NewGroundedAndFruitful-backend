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
import { authenticate } from "../../middleware/authentication.js";
import {
  requireAuthenticated,
  requirePlatformSuperAdmin,
} from "../authorization.js";
import {
  WorkspaceService,
  registrationIntentSchema,
  workspaceSelectionSchema,
} from "../workspaces.js";
import { ElevationService, elevationGrantSchema } from "../elevations.js";

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
const workspaces = new WorkspaceService(db);
const elevations = new ElevationService(db);

router.post(
  "/session",
  (req, res, next) => void sessionController.create(req, res).catch(next),
);
router.get(
  "/session",
  (req, res, next) => void sessionController.create(req, res).catch(next),
);

router.post(
  "/registration",
  authenticate,
  validateBody(registrationIntentSchema),
  (req, res, next) => {
    const actor = requireAuthenticated(req.principal);
    void workspaces
      .register(
        actor.uid,
        String(actor.token.name ?? actor.token.email ?? ""),
        req.body,
      )
      .then((data) => res.status(201).json({ data }))
      .catch(next);
  },
);
router.put(
  "/session/workspace",
  authenticate,
  validateBody(workspaceSelectionSchema),
  (req, res, next) => {
    const actor = requireAuthenticated(req.principal);
    void workspaces
      .select(actor.uid, req.body.workspaceId)
      .then((data) => res.json({ data }))
      .catch(next);
  },
);
router.post(
  "/elevations",
  authenticate,
  validateBody(elevationGrantSchema),
  (req, res, next) => {
    const actor = requirePlatformSuperAdmin(req.principal);
    const recentlyAuthenticated =
      typeof actor.token.auth_time === "number" &&
      Date.now() / 1000 - actor.token.auth_time <= 300;
    void elevations
      .grant(actor.uid, recentlyAuthenticated, req.body)
      .then((data) => res.status(201).json({ data }))
      .catch(next);
  },
);
router.post("/elevations/:grantId/revoke", authenticate, (req, res, next) => {
  const actor = requirePlatformSuperAdmin(req.principal);
  void elevations
    .revoke(String(req.params.grantId), actor.uid)
    .then((data) => res.json({ data }))
    .catch(next);
});

router.post(
  "/child-token",
  validateBody(childLoginSchema),
  childCredentialRateLimit(db, 15 * 60_000, 10),
  (req, res, next) => void controller.login(req, res).catch(next),
);

export default router;
