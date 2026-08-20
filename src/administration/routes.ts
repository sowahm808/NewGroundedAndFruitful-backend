import { Router, type RequestHandler } from "express";
import { auth, db } from "../config/firebase.js";
import { validateBody } from "../middleware/validate.js";
import { idSchema } from "../shared/validation.js";
import { ValidationError } from "../shared/errors.js";
import { AdministrationService } from "./service.js";
import * as schemas from "./schemas.js";

const router = Router(),
  service = new AdministrationService(db, auth);
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
  "/organizations",
  validateBody(schemas.organizationCreateSchema),
  run((req) => service.createOrganization(req.principal, req.body), 201),
);
router.get(
  "/organizations",
  run((req) => service.organizations(req.principal)),
);
router.get(
  "/organizations/:organizationId",
  run((req) =>
    service.organization(req.principal, id(req.params.organizationId)),
  ),
);
router.patch(
  "/organizations/:organizationId",
  validateBody(schemas.organizationUpdateSchema),
  run((req) =>
    service.updateOrganization(
      req.principal,
      id(req.params.organizationId),
      req.body,
    ),
  ),
);
router.post(
  "/organizations/:organizationId/suspend",
  validateBody(schemas.lifecycleVersionSchema),
  run((req) =>
    service.updateOrganization(
      req.principal,
      id(req.params.organizationId),
      req.body,
      "suspended",
    ),
  ),
);
router.post(
  "/organizations/:organizationId/reactivate",
  validateBody(schemas.lifecycleVersionSchema),
  run((req) =>
    service.updateOrganization(
      req.principal,
      id(req.params.organizationId),
      req.body,
      "active",
    ),
  ),
);
router.post(
  "/programs",
  validateBody(schemas.programCreateSchema),
  run((req) => service.createProgram(req.principal, req.body), 201),
);
router.get(
  "/teams",
  run((req) => service.teams(req.principal, id(req.query.organizationId))),
);
router.get(
  "/teams/:teamId",
  run((req) => service.team(req.principal, id(req.params.teamId))),
);
router.post(
  "/parent-onboarding",
  validateBody(schemas.parentOnboardingSchema),
  run((req) => service.onboardParent(req.principal, req.body), 201),
);
router.post(
  "/participants",
  validateBody(schemas.participantCreateSchema),
  run((req) => service.createParticipant(req.principal, req.body), 201),
);
router.get(
  "/participants",
  run((req) =>
    service.roster(
      req.principal,
      id(req.query.organizationId),
      req.query.programId ? id(req.query.programId) : undefined,
    ),
  ),
);
router.patch(
  "/participants/:participantId",
  validateBody(schemas.participantUpdateSchema),
  run((req) =>
    service.updateParticipant(
      req.principal,
      id(req.params.participantId),
      req.body,
    ),
  ),
);
router.delete(
  "/participants/:participantId",
  run((req) =>
    service.updateParticipant(
      req.principal,
      id(req.params.participantId),
      {},
      true,
    ),
  ),
);
router.put(
  "/teams/:teamId/mentors",
  validateBody(schemas.teamMentorSchema),
  run((req) =>
    service.assignTeamMentor(
      req.principal,
      id(req.params.teamId),
      req.body.userId,
      req.body.expiresAt,
    ),
  ),
);
router.delete(
  "/teams/:teamId/mentors/:userId",
  run((req) =>
    service.assignTeamMentor(
      req.principal,
      id(req.params.teamId),
      id(req.params.userId),
      undefined,
      true,
    ),
  ),
);
router.post(
  "/relationships",
  validateBody(schemas.relationshipSchema),
  run((req) => service.createRelationship(req.principal, req.body), 201),
);
router.post(
  "/relationships/:relationshipId/activate",
  run((req) =>
    service.activateRelationship(req.principal, id(req.params.relationshipId)),
  ),
);
router.post(
  "/teams",
  validateBody(schemas.teamCreateSchema),
  run((req) => service.createTeam(req.principal, req.body), 201),
);
router.patch(
  "/teams/:teamId",
  validateBody(schemas.teamUpdateSchema),
  run((req) =>
    service.updateTeam(req.principal, id(req.params.teamId), req.body),
  ),
);
router.put(
  "/teams/:teamId/members",
  validateBody(schemas.teamMemberSchema),
  run((req) =>
    service.assignTeamMember(
      req.principal,
      id(req.params.teamId),
      req.body.participantId,
    ),
  ),
);
router.get(
  "/organizations/:organizationId/memberships",
  run((req) =>
    service.memberships(req.principal, id(req.params.organizationId)),
  ),
);
router.delete(
  "/teams/:teamId/members/:participantId",
  run((req) =>
    service.assignTeamMember(
      req.principal,
      id(req.params.teamId),
      id(req.params.participantId),
      true,
    ),
  ),
);
router.post(
  "/invitations",
  validateBody(schemas.invitationCreateSchema),
  run((req) => service.invite(req.principal, req.body), 201),
);
router.post(
  "/invitations/:invitationId/accept",
  run((req) =>
    service.acceptInvitation(req.principal, id(req.params.invitationId)),
  ),
);
router.post(
  "/invitations/:invitationId/decision",
  validateBody(schemas.invitationDecisionSchema),
  run((req) =>
    service.decideInvitation(
      req.principal,
      id(req.params.invitationId),
      req.body.decision,
    ),
  ),
);
router.post(
  "/consents",
  validateBody(schemas.consentCaptureSchema),
  run((req) => service.captureConsent(req.principal, req.body), 201),
);
router.get(
  "/participants/:participantId/consents",
  run((req) =>
    service.consentHistory(req.principal, id(req.params.participantId)),
  ),
);
router.delete(
  "/participants/:participantId/consents/:policyKey",
  run((req) =>
    service.withdrawConsent(
      req.principal,
      id(req.params.participantId),
      id(req.params.policyKey),
    ),
  ),
);
router.put(
  "/organizations/:organizationId/users/:userId/memberships",
  validateBody(schemas.roleUpdateSchema),
  run((req) =>
    service.setMembership(
      req.principal,
      id(req.params.organizationId),
      id(req.params.userId),
      req.body.role,
      req.body.status,
      req.body.version,
      req.body.expiresAt,
    ),
  ),
);

export default router;
