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

/**
 * Resolves the tenant organization context across request parts, auth claims, and database fallbacks.
 */
export const resolveTenantOrganizationId = async (
  req: Parameters<RequestHandler>[0],
  explicitValue?: unknown,
): Promise<string> => {
  const principal = req.principal as Record<string, unknown> | undefined;
  const memberships = Array.isArray(principal?.memberships)
    ? (principal.memberships as Array<Record<string, unknown>>)
    : [];

  const candidate =
    (typeof explicitValue === "string" && explicitValue.trim()) ||
    (typeof req.query?.organizationId === "string" && req.query.organizationId.trim()) ||
    (typeof req.body?.organizationId === "string" && req.body.organizationId.trim()) ||
    (typeof req.headers["x-organization-id"] === "string" && req.headers["x-organization-id"].trim()) ||
    (typeof req.headers["x-workspace-id"] === "string" && req.headers["x-workspace-id"].trim()) ||
    principal?.activeOrganizationId ||
    principal?.activeWorkspaceId ||
    principal?.workspaceId ||
    principal?.organizationId ||
    (Array.isArray(principal?.organizationIds) && principal.organizationIds[0]) ||
    (Array.isArray(principal?.workspaceIds) && principal.workspaceIds[0]) ||
    memberships[0]?.organizationId ||
    memberships[0]?.workspaceId;

  if (candidate) return String(candidate);

  if (principal?.uid) {
    const snap = await db
      .collection("memberships")
      .where("userId", "==", principal.uid)
      .where("status", "==", "active")
      .get();

    const adminMembership = snap.docs.find((doc) => {
      const roles = doc.get("roles") ?? [doc.get("role")];
      return (
        Array.isArray(roles) &&
        (roles.includes("admin") || roles.includes("super_admin") || roles.includes("owner"))
      );
    });

    if (adminMembership) {
      return String(adminMembership.get("organizationId") || adminMembership.get("workspaceId"));
    }

    if (!snap.empty) {
      return String(snap.docs[0]!.get("organizationId") || snap.docs[0]!.get("workspaceId"));
    }
  }

  throw new ValidationError("Organization context is required.");
};

// -------------------------------------------------------------
// Teams API
// -------------------------------------------------------------
router.get(
  "/teams",
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(req, req.query.organizationId);
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
    const orgId = await resolveTenantOrganizationId(req, req.body.organizationId);

    const payload = {
      ...req.body,
      organizationId: orgId,
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

    return service.createTeam(req.principal, parsed.data);
  }, 201),
);

router.patch(
  "/teams/:teamId",
  validateBody(schemas.teamUpdateSchema),
  run((req) => service.updateTeam(req.principal, id(req.params.teamId), req.body)),
);

router.put(
  "/teams/:teamId/members",
  validateBody(schemas.teamMemberSchema),
  run((req) => service.assignTeamMember(req.principal, id(req.params.teamId), req.body.participantId)),
);

router.delete(
  "/teams/:teamId/members/:participantId",
  run((req) => service.assignTeamMember(req.principal, id(req.params.teamId), id(req.params.participantId), true)),
);

// -------------------------------------------------------------
// Participants API
// -------------------------------------------------------------
router.post(
  "/participants",
  requireCapability("admin.participants.manage"),
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(req, req.body.organizationId);
    const guardianUserId =
      (typeof req.body.guardianUserId === "string" && req.body.guardianUserId) ||
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
  run((req) => {
    const parsedQuery = schemas.participantListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new ValidationError("Invalid participant list query.", {
        fieldErrors: parsedQuery.error.flatten().fieldErrors,
      });
    }
    return service.roster(req.principal, parsedQuery.data);
  }),
);

router.get(
  "/participants/:participantId",
  requireCapability("admin.participants.read"),
  run((req) => service.participant(req.principal, id(req.params.participantId))),
);

router.patch(
  "/participants/:participantId",
  requireCapability("admin.participants.manage"),
  run((req) => service.updateParticipant(req.principal, id(req.params.participantId), req.body)),
);

router.delete(
  "/participants/:participantId",
  requireCapability("admin.participants.manage"),
  run((req) => service.updateParticipant(req.principal, id(req.params.participantId), {}, true)),
);

export default router;