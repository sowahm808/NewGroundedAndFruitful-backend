import { Router, type RequestHandler } from "express";
import { childCredentialRateLimit } from "../../middleware/rate-limit.js";
import { auth, db } from "../../config/firebase.js";
import { validateBody } from "../../middleware/validate.js";
import { AuditRepository } from "../../audit/repository.js";
import { ChildLoginController } from "../controllers/child-login.js";
import { AuthSessionController } from "../controllers/session.js";
import { ChildCredentialRepository } from "../repositories/child-credentials.js";
import { UserRepository } from "../repositories/users.js";
import { MembershipRepository } from "../repositories/memberships.js";
import {
  childLoginSchema,
  participantChildLoginSchema,
} from "../schemas/child-login.js";
import { ChildLoginService } from "../services/child-login.js";
import { ParticipantChildLoginRepository } from "../repositories/participant-child-login.js";
import { ParticipantChildLoginService } from "../services/participant-child-login.js";
import { AuthSessionService } from "../services/session.js";
import { LogoutService } from "../services/logout.js";
import {
  authenticate,
  requireEnabledRegistrationAccount,
  requireFirebaseAuthentication,
} from "../../middleware/authentication.js";
import {
  requireAuthenticated,
  requirePlatformSuperAdmin,
} from "../authorization.js";
import {
  WorkspaceService,
  RegistrationIntentService,
  registrationIntentSchema,
  workspaceSelectionSchema,
} from "../workspaces.js";
import { ElevationService, elevationGrantSchema } from "../elevations.js";
import {
  AppError,
  RegistrationIntentInvalidError,
  RegistrationIntentSaveError,
} from "../../shared/errors.js";

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
const participantChildLogin = new ParticipantChildLoginService(
  new ParticipantChildLoginRepository(db),
  auth,
);
const workspaces = new WorkspaceService(db);
const registrationIntents = new RegistrationIntentService(db);
const elevations = new ElevationService(db);
const logout = new LogoutService(auth);

router.post("/logout", (_req, res) => {
  logout.logout();
  res.sendStatus(204);
});
router.post("/logout-all", requireFirebaseAuthentication, (req, res, next) => {
  const actor = requireAuthenticated(req.principal);
  void logout
    .logoutAll(actor.uid)
    .then(() => res.sendStatus(204))
    .catch(next);
});

router.post(
  "/session",
  (req, res, next) => void sessionController.create(req, res).catch(next),
);
router.get(
  "/session",
  (req, res, next) => void sessionController.create(req, res).catch(next),
);

const registerIntent = [
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
] satisfies RequestHandler[];

router.post("/registration", ...registerIntent);
router.post(
  "/registration-intent",
  requireFirebaseAuthentication,
  requireEnabledRegistrationAccount,
  (req, _res, next) => {
    const parsed = registrationIntentSchema.safeParse(req.body);
    if (!parsed.success)
      return next(new RegistrationIntentInvalidError(parsed.error.flatten()));
    req.body = parsed.data;
    next();
  },
  (req, res, next) => {
    const actor = requireAuthenticated(req.principal);
    void registrationIntents
      .select(
        actor.uid,
        {
          email:
            typeof actor.token.email === "string" ? actor.token.email : null,
          displayName: String(actor.token.name ?? actor.token.email ?? ""),
        },
        req.body.intent,
        req.requestId,
      )
      .then((data) => res.status(201).json({ data }))
      .catch((error: unknown) =>
        next(
          error instanceof AppError ? error : new RegistrationIntentSaveError(),
        ),
      );
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
router.post(
  "/child-login",
  validateBody(participantChildLoginSchema),
  childCredentialRateLimit(db, 15 * 60_000, 10),
  (req, res, next) =>
    void participantChildLogin
      .login(req.body)
      .then((data) => res.set("Cache-Control", "no-store").json(data))
      .catch(next),
);

export default router;
