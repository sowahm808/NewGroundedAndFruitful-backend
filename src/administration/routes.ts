import { Router, type RequestHandler } from "express";
import { auth, db } from "../config/firebase.js";
import { validateBody } from "../middleware/validate.js";
import { idSchema } from "../shared/validation.js";
import { ValidationError } from "../shared/errors.js";
import { AdministrationService } from "./service.js";
import * as schemas from "./schemas.js";
import { QuarterAdministrationService } from "./quarters.js";
import bibleAdminRoutes from "../bible/admin-routes.js";
import { requireCapability } from "../middleware/authorize.js";

const router = Router(),
  service = new AdministrationService(db, auth),
  quarters = new QuarterAdministrationService(db);
router.use(bibleAdminRoutes);
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
const configuredResources = [
  ["assignments", "assignments"],
  ["character-qualities", "characterQualities"],
  ["character-cycles", "characterCycles"],
  ["family-activities", "familyActivities"],
  ["books", "books"],
  ["reading-assignments", "readingAssignments"],
  ["surveys", "surveys"],
  ["point-rules", "pointRules"],
] as const;
for (const [path, collection] of configuredResources) {
  router.get(
    `/${path}`,
    run((req) => {
      const query = schemas.resourceListQuerySchema.safeParse(req.query);
      if (!query.success)
        throw new ValidationError("Invalid resource list query.", {
          fieldErrors: query.error.flatten().fieldErrors,
        });
      return service.listResources(req.principal, collection, query.data);
    }),
  );
  router.get(
    `/${path}/:resourceId`,
    run((req) =>
      service.resource(req.principal, collection, id(req.params.resourceId)),
    ),
  );
  router.post(
    `/${path}`,
    validateBody(schemas.resourceCreateSchema),
    run(
      (req) => service.createResource(req.principal, collection, req.body),
      201,
    ),
  );
  router.post(
    `/${path}/:resourceId/publish`,
    validateBody(schemas.resourceLifecycleSchema),
    run((req) =>
      service.transitionResource(
        req.principal,
        collection,
        id(req.params.resourceId),
        req.body.version,
        "publish",
      ),
    ),
  );
  router.post(
    `/${path}/:resourceId/archive`,
    validateBody(schemas.resourceLifecycleSchema),
    run((req) =>
      service.transitionResource(
        req.principal,
        collection,
        id(req.params.resourceId),
        req.body.version,
        "archive",
      ),
    ),
  );
}
const query = <T>(
  result: {
    success: boolean;
    data?: T;
    error?: { flatten(): { fieldErrors: unknown } };
  },
  message: string,
): T => {
  if (!result.success)
    throw new ValidationError(message, {
      fieldErrors: result.error?.flatten().fieldErrors,
    });
  return result.data as T;
};
router.get(
  "/quarters",
  run((req) =>
    quarters.list(
      req.principal,
      query(
        schemas.quarterListQuerySchema.safeParse(req.query),
        "Invalid quarter list query.",
      ),
    ),
  ),
);
router.get(
  "/quarters/:quarterId",
  run((req) => quarters.get(req.principal, id(req.params.quarterId))),
);
router.post(
  "/quarters",
  validateBody(schemas.quarterCreateSchema),
  run((req) => quarters.create(req.principal, req.body, req.requestId), 201),
);
router.patch(
  "/quarters/:quarterId",
  validateBody(schemas.quarterUpdateSchema),
  run((req) =>
    quarters.update(
      req.principal,
      id(req.params.quarterId),
      req.body,
      req.requestId,
    ),
  ),
);
for (const [action, status] of [
  ["activate", "active"],
  ["close", "closed"],
  ["archive", "archived"],
] as const) {
  router.post(
    `/quarters/:quarterId/${action}`,
    validateBody(schemas.quarterLifecycleSchema),
    run((req) =>
      quarters.transition(
        req.principal,
        id(req.params.quarterId),
        req.body,
        status,
        req.requestId,
      ),
    ),
  );
}
router.get(
  "/users",
  run((req) => {
    const query = schemas.userListQuerySchema.safeParse(req.query);
    if (!query.success)
      throw new ValidationError("Invalid user list query.", {
        fieldErrors: query.error.flatten().fieldErrors,
      });
    return service.users(req.principal, query.data);
  }),
);
router.get(
  "/memberships",
  run((req) => {
    const query = schemas.membershipListQuerySchema.safeParse(req.query);
    if (!query.success)
      throw new ValidationError("Invalid membership list query.", {
        fieldErrors: query.error.flatten().fieldErrors,
      });
    return service.listMemberships(req.principal, query.data);
  }),
);
router.get(
  "/roles",
  run((req) => {
    const query = schemas.roleListQuerySchema.safeParse(req.query);
    if (!query.success)
      throw new ValidationError("Invalid role list query.", {
        fieldErrors: query.error.flatten().fieldErrors,
      });
    return service.listMemberships(req.principal, query.data);
  }),
);
router.get(
  "/reports",
  run((req) =>
    service.resources(req.principal, "reports", id(req.query.organizationId)),
  ),
);
router.get(
  "/awards",
  run((req) =>
    service.resources(req.principal, "awards", id(req.query.organizationId)),
  ),
);
router.get(
  "/audits",
  run((req) =>
    service.resources(
      req.principal,
      "auditLogs",
      id(req.query.organizationId),
      true,
    ),
  ),
);

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
// in src/administration/routes.ts

router.get(
  "/teams",
  run((req) => {
    const query = schemas.teamListQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new ValidationError("Invalid team list query.", {
        fieldErrors: query.error.flatten().fieldErrors,
      });
    }

    const orgId = query.data.organizationId ?? req.principal?.organizationIds?.[0];
    if (!orgId) {
      throw new ValidationError("Organization context is required.");
    }

    // Call service.teams or your paginated teams method
    return service.teams(req.principal, orgId, query.data);
  }),
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
  requireCapability("admin.participants.manage"),
  validateBody(schemas.participantCreateSchema),
  run((req) => service.createParticipant(req.principal, req.body), 201),
);
router.get(
  "/participants",
  requireCapability("admin.participants.read"),
  run((req) =>
    service.roster(
      req.principal,
      query(
        schemas.participantListQuerySchema.safeParse(req.query),
        "Invalid participant list query.",
      ),
    ),
  ),
);
router.get(
  "/participants/:participantId",
  requireCapability("admin.participants.read"),
  run((req) =>
    service.participant(req.principal, id(req.params.participantId)),
  ),
);
router.patch(
  "/participants/:participantId",
  requireCapability("admin.participants.manage"),
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
  requireCapability("admin.participants.manage"),
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
