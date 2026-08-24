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

const router = Router();
const service = new AdministrationService(db, auth);
const quarters = new QuarterAdministrationService(db);

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

const query = <T>(
  result: {
    success: boolean;
    data?: T;
    error?: { flatten(): { fieldErrors: unknown } };
  },
  message: string,
): T => {
  if (!result.success) {
    throw new ValidationError(message, {
      fieldErrors: result.error?.flatten().fieldErrors,
    });
  }
  return result.data as T;
};

/** Resolve only canonical tenant context. Request values must already be validated. */
export const tenantOrganizationCandidate = (
  req: {
    query?: { organizationId?: unknown; workspaceId?: unknown };
    body?: { organizationId?: unknown; workspaceId?: unknown };
    headers: Record<string, unknown>;
    principal?: unknown;
  },
  explicitValue?: unknown,
): string | undefined => {
  const principal = req.principal as Record<string, unknown> | undefined;
  const memberships = Array.isArray(principal?.memberships)
    ? (principal.memberships as Array<Record<string, unknown>>)
    : [];

  const activeMemberships = memberships.filter(
    (membership) => membership.status === "active",
  );
  const candidates = [
    explicitValue,
    principal?.activeOrganizationId,
    activeMemberships.length === 1
      ? activeMemberships[0]?.organizationId
      : undefined,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
};

export const resolveTenantOrganizationId = async (
  req: Parameters<RequestHandler>[0],
  explicitValue?: unknown,
): Promise<string> => {
  const principal = req.principal as Record<string, unknown> | undefined;
  const candidate = tenantOrganizationCandidate(req, explicitValue);

  if (candidate) return candidate;

  // Support older internal principals, but never select among several tenants.
  if (principal?.uid) {
    const snap = await db
      .collection("memberships")
      .where("userId", "==", principal.uid)
      .where("status", "==", "active")
      .get();

    if (snap.size === 1) {
      const membership = snap.docs[0]!;
      return String(
        membership.get("organizationId") || membership.get("workspaceId"),
      );
    }
  }

  throw new ValidationError("Organization context is required.");
};

// -------------------------------------------------------------
// Configured Generic Resources Loop
// -------------------------------------------------------------
const configuredResources = [
  ["assignments", "assignments"],
  ["character-qualities", "characterQualities"],
  ["character-cycles", "characterCycles"],
  ["family-activities", "familyActivities"],
  ["books", "books"],
  ["reading-assignments", "readingAssignments"],
  ["projects", "projects"],
  ["surveys", "surveys"],
  ["point-rules", "pointRules"],
] as const;

for (const [path, collection] of configuredResources) {
  router.get(
    `/${path}`,
    run(async (req) => {
      const parsedQuery = schemas.resourceListQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        throw new ValidationError("Invalid resource list query.", {
          fieldErrors: parsedQuery.error.flatten().fieldErrors,
        });
      }

      const organizationId = await resolveTenantOrganizationId(
        req,
        parsedQuery.data.organizationId,
      );

      return service.listResources(req.principal, collection, {
        ...parsedQuery.data,
        organizationId,
      });
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

// -------------------------------------------------------------
// Quarters API
// -------------------------------------------------------------
router.get(
  "/quarters",
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(
      req,
      req.query.organizationId,
    );
    const parsedQuery = schemas.quarterListQuerySchema.safeParse({
      ...req.query,
      organizationId: orgId,
    });

    if (!parsedQuery.success) {
      throw new ValidationError("Invalid quarter list query.", {
        fieldErrors: parsedQuery.error.flatten().fieldErrors,
      });
    }

    return quarters.list(req.principal, parsedQuery.data);
  }),
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
  ["activate", "open"],
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

// -------------------------------------------------------------
// Users, Memberships & Roles
// -------------------------------------------------------------
router.get(
  "/users",
  run((req) => {
    const q = schemas.userListQuerySchema.safeParse(req.query);
    if (!q.success) {
      throw new ValidationError("Invalid user list query.", {
        fieldErrors: q.error.flatten().fieldErrors,
      });
    }
    return service.users(req.principal, q.data);
  }),
);

router.get(
  "/memberships",
  run((req) => {
    const q = schemas.membershipListQuerySchema.safeParse(req.query);
    if (!q.success) {
      throw new ValidationError("Invalid membership list query.", {
        fieldErrors: q.error.flatten().fieldErrors,
      });
    }
    return service.listMemberships(req.principal, q.data);
  }),
);

router.get(
  "/roles",
  run((req) => {
    const q = schemas.roleListQuerySchema.safeParse(req.query);
    if (!q.success) {
      throw new ValidationError("Invalid role list query.", {
        fieldErrors: q.error.flatten().fieldErrors,
      });
    }
    return service.listMemberships(req.principal, q.data);
  }),
);

router.get(
  "/reports",
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(
      req,
      req.query.organizationId,
    );
    return service.resources(req.principal, "reports", id(orgId));
  }),
);

router.get(
  "/awards",
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(
      req,
      req.query.organizationId,
    );
    return service.resources(req.principal, "awards", id(orgId));
  }),
);

router.get(
  "/audits",
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(
      req,
      req.query.organizationId,
    );
    return service.resources(req.principal, "auditLogs", id(orgId), true);
  }),
);

// -------------------------------------------------------------
// Organizations & Programs
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// Teams Management
// -------------------------------------------------------------
router.get(
  "/teams",
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(
      req,
      req.query.organizationId,
    );
    const parsedQuery = schemas.teamListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new ValidationError("Invalid team list query.", {
        fieldErrors: parsedQuery.error.flatten().fieldErrors,
      });
    }

    return service.teams(req.principal, orgId, parsedQuery.data);
  }),
);

router.get(
  "/teams/:teamId",
  run((req) => service.team(req.principal, id(req.params.teamId))),
);

router.post(
  "/teams",
  run(async (req) => {
    const payload = {
      organizationId: req.body.organizationId,
      name: req.body.name,
      displayName: req.body.displayName || req.body.name,
      approvedDisplayName: req.body.displayName || req.body.name,
      capacity: Number(req.body.capacity ?? 5),
      targetPoints: Number(req.body.targetPoints ?? 5000),
      quarterId: req.body.quarterId ?? null,
      programId: req.body.programId ?? null,
    };

    const parsed = schemas.teamCreateSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ValidationError("Invalid team payload.", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const orgId = await resolveTenantOrganizationId(
      req,
      parsed.data.organizationId,
    );

    return service.createTeam(req.principal, {
      ...parsed.data,
      organizationId: orgId,
    });
  }, 201),
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

// -------------------------------------------------------------
// Participants API
// -------------------------------------------------------------
router.post(
  "/parent-onboarding",
  validateBody(schemas.parentOnboardingSchema),
  run((req) => service.onboardParent(req.principal, req.body), 201),
);

router.post(
  "/participants",
  requireCapability("admin.participants.manage"),
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(
      req,
      req.body.organizationId,
    );
    const guardianUserId =
      (typeof req.body.guardianUserId === "string" &&
        req.body.guardianUserId) ||
      req.principal?.uid ||
      "";

    const payload = {
      ...req.body,
      organizationId: orgId,
      guardianUserId,
      programId: req.body.programId || "default-program",
      birthDate: req.body.birthDate || "2015-01-01",
    };

    const parsed = schemas.participantCreateSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ValidationError("Invalid participant payload.", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    return service.createParticipant(req.principal, parsed.data);
  }, 201),
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

// -------------------------------------------------------------
// Relationships, Invitations, Consents & Memberships
// -------------------------------------------------------------
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

router.get(
  "/organizations/:organizationId/memberships",
  run((req) =>
    service.memberships(req.principal, id(req.params.organizationId)),
  ),
);

router.post(
  "/invitations",
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(
      req,
      req.body.organizationId,
    );

    const payload = {
      ...req.body,
      organizationId: orgId,
    };

    const parsed = schemas.invitationCreateSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ValidationError("Invalid invitation payload.", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    return service.invite(req.principal, parsed.data);
  }, 201),
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
