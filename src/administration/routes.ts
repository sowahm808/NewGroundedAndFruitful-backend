import { Router, type RequestHandler } from "express";
import { auth, db } from "../config/firebase.js";
import { validateBody } from "../middleware/validate.js";
import { idSchema } from "../shared/validation.js";
import { ValidationError, NotFoundError } from "../shared/errors.js";
import { AdministrationService } from "./service.js";
import * as schemas from "./schemas.js";
import { QuarterAdministrationService } from "./quarters.js";
import bibleAdminRoutes from "../bible/admin-routes.js";
import { requireCapability } from "../middleware/authorize.js";
import { createHash } from "node:crypto";

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
  // Program assignments are created by ConfigurationService in the canonical
  // contentAssignments collection. Reading the unused `assignments`
  // collection made the administration screen permanently appear empty.
  ["assignments", "contentAssignments"],
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
    run(async (req) => {
      const organizationId = await resolveTenantOrganizationId(
        req,
        req.body.organizationId,
      );
      const parsed = schemas.resourceCreateSchema.safeParse({
        ...req.body,
        organizationId,
      });
      if (!parsed.success) {
        throw new ValidationError("Invalid resource payload.", {
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
      }

      return service.createResource(req.principal, collection, parsed.data);
    }, 201),
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

// router.get(
//   "/reports",
//   run(async (req) => {
//     const orgId = await resolveTenantOrganizationId(
//       req,
//       req.query.organizationId,
//     );
//     return service.resources(req.principal, "reports", id(orgId));
//   }),
// );
// -------------------------------------------------------------
// Reports Job Management (src/administration/routes.ts)
// -------------------------------------------------------------

// GET /api/v1/admin/reports -> returns { items: ReportJob[] }
router.get(
  "/reports",
  requireCapability("admin.reports.read"),
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(
      req,
      req.query.organizationId,
    );

    const snap = await db
      .collection("reportJobs")
      .where("organizationId", "==", orgId)
      .orderBy("createdAt", "desc")
      .get();

    const items = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        reportType: d.reportType,
        reportName: d.reportName,
        quarterName: d.quarterName,
        periodStart: d.periodStart,
        periodEnd: d.periodEnd,
        scopeLabel: d.scopeLabel || "Organization scope",
        status: d.status || "queued",
        requestedBy: d.requestedBy || "Admin",
        createdAt: d.createdAt,
        completedAt: d.completedAt,
        expiresAt: d.expiresAt,
        allowedActions:
          d.status === "completed"
            ? ["view", "download"]
            : d.status === "failed"
              ? ["retry"]
              : ["cancel"],
      };
    });

    return { items };
  }),
);

// POST /api/v1/admin/reports -> creates a ReportJob record
router.post(
  "/reports",
  requireCapability("admin.reports.create"),
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(
      req,
      req.body.organizationId,
    );
    const { reportType, quarterId, teamId, periodStart, periodEnd } = req.body;

    const principal = req.principal as Record<string, unknown> | undefined;
    const requester =
      (typeof principal?.displayName === "string" && principal.displayName) ||
      (typeof principal?.email === "string" && principal.email) ||
      req.principal?.uid ||
      "Admin";

    const jobRef = db.collection("reportJobs").doc();
    const newJob = {
      id: jobRef.id,
      organizationId: orgId,
      reportType,
      quarterId: quarterId || null,
      teamId: teamId || null,
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      scopeLabel: "Organization scope",
      status: "queued",
      requestedBy: requester,
      createdAt: new Date().toISOString(),
      allowedActions: ["cancel"],
      version: 1,
    };

    await jobRef.set(newJob);
    return newJob;
  }, 201),
);

// GET /api/v1/admin/reports/:jobId -> single job polling status
router.get(
  "/reports/:jobId",
  requireCapability("admin.reports.read"),
  run(async (req) => {
    const jobId = id(req.params.jobId);
    const doc = await db.collection("reportJobs").doc(jobId).get();
    if (!doc.exists) throw new ValidationError("Report job not found.");
    return { id: doc.id, ...doc.data() };
  }),
);

// POST /api/v1/admin/reports/:jobId/download -> signed download url
router.post(
  "/reports/:jobId/download",
  requireCapability("admin.reports.read"),
  run(async (req) => {
    const jobId = id(req.params.jobId);
    const doc = await db.collection("reportJobs").doc(jobId).get();
    if (!doc.exists) throw new ValidationError("Report job not found.");
    const data = doc.data();

    return {
      url:
        data?.downloadUrl ||
        `https://storage.googleapis.com/exports/${jobId}.csv`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }),
);

// POST /api/v1/admin/reports/:jobId/:command (retry | cancel)
router.post(
  "/reports/:jobId/:command",
  requireCapability("admin.reports.create"),
  run(async (req) => {
    const jobId = id(req.params.jobId);
    const command =
      typeof req.params.command === "string" ? req.params.command : "";

    if (command !== "retry" && command !== "cancel") {
      throw new ValidationError(
        "Invalid report command. Expected 'retry' or 'cancel'.",
      );
    }

    const ref = db.collection("reportJobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) throw new ValidationError("Report job not found.");

    const nextStatus = command === "retry" ? "queued" : "cancelled";
    await ref.update({
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    });

    return { id: doc.id, ...doc.data(), status: nextStatus };
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

router.put(
  "/organizations/:organizationId/users/:userId/memberships",
  validateBody(schemas.roleUpdateSchema),
  run(async (req) => {
    const orgId =
      req.params.organizationId === "current"
        ? await resolveTenantOrganizationId(req)
        : id(req.params.organizationId);

    return service.setMembership(
      req.principal,
      orgId,
      id(req.params.userId),
      req.body.role,
      req.body.status,
      req.body.version,
      req.body.expiresAt,
    );
  }),
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

// POST /api/v1/admin/participants/:participantId/invite-guardian
router.post(
  "/participants/:participantId/invite-guardian",
  requireCapability("admin.participants.manage"),
  validateBody(schemas.guardianInvitationSchema),
  run(async (req) => {
    const orgId = await resolveTenantOrganizationId(
      req,
      req.body?.organizationId,
    );
    const participantId = id(req.params.participantId);
    const email = String(req.body.email).trim().toLowerCase();
    const relationship =
      typeof req.body?.relationship === "string"
        ? req.body.relationship
        : "parent";

    const participantRef = db.collection("participants").doc(participantId);
    const participantDoc = await participantRef.get();

    if (
      !participantDoc.exists ||
      participantDoc.get("organizationId") !== orgId
    ) {
      throw new NotFoundError("Participant not found in current organization.");
    }

    // 1. Resolve organization name
    const orgDoc = await db.collection("organizations").doc(orgId).get();
    const orgData = orgDoc.data();
    const orgName =
      (orgDoc.exists && orgData && (orgData.name || orgData.displayName)) ||
      "Your Organization";

    // 2. Query user snapshot with safe null check
    const [canonicalUser, legacyUser] = await Promise.all([
      db
        .collection("users")
        .where("emailNormalized", "==", email)
        .limit(1)
        .get(),
      db.collection("users").where("email", "==", email).limit(1).get(),
    ]);
    const existingUserSnap = canonicalUser.empty ? legacyUser : canonicalUser;

    const parentUid: string | null =
      !existingUserSnap.empty && existingUserSnap.docs[0]
        ? existingUserSnap.docs[0].id
        : null;

    // 3. Create or update parentChildLinks
    const emailHash = createHash("sha256")
      .update(email)
      .digest("hex")
      .slice(0, 12);
    const linkId = `${parentUid || `pending_${emailHash}`}_${participantId}`;
    const linkRef = db.collection("parentChildLinks").doc(linkId);

    const now = new Date().toISOString();
    const linkData = {
      id: linkId,
      organizationId: orgId,
      participantId,
      parentUid: parentUid || null,
      guardianUserId: parentUid || null,
      guardianEmail: email,
      relationship,
      status: parentUid ? "active" : "pending_acceptance",
      updatedAt: now,
      createdAt: now,
      version: 1,
    };

    // Keep the relationship and participant projection consistent. A stable
    // pending id also makes repeated invitations an upsert rather than creating
    // duplicate relationships.
    const batch = db.batch();
    batch.set(linkRef, linkData, { merge: true });

    // 4. Update participant record
    batch.update(participantRef, {
      ...(parentUid ? { guardianUserId: parentUid } : {}),
      guardianEmail: email,
      updatedAt: now,
    });

    // 5. Enqueue invitation email
    const mailRef = db.collection("mailQueue").doc();
    batch.create(mailRef, {
      to: email,
      template: "guardian_invitation",
      organizationName: orgName,
      participantName:
        participantDoc.get("approvedDisplayName") ||
        participantDoc.get("displayName") ||
        "Your Child",
      joinUrl: `https://groundedandfruitful.netlify.app/parent-onboarding?email=${encodeURIComponent(email)}&orgId=${encodeURIComponent(orgId)}`,
      data: {
        organizationName: orgName,
        participantName:
          participantDoc.get("displayName") ||
          participantDoc.get("approvedDisplayName") ||
          "Your Child",
        joinUrl: `https://groundedandfruitful.netlify.app/parent-onboarding?email=${encodeURIComponent(
          email,
        )}&orgId=${encodeURIComponent(orgId)}`,
      },
      createdAt: now,
      status: "queued",
    });
    await batch.commit();

    return {
      success: true,
      status: parentUid ? "linked" : "invitation_sent",
      guardianEmail: email,
    };
  }),
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
      typeof req.body.guardianUserId === "string"
        ? req.body.guardianUserId
        : undefined;

    const payload = {
      ...req.body,
      organizationId: orgId,
      ...(req.body.teamId && !req.body.activeTeamId
        ? { activeTeamId: req.body.teamId }
        : {}),
      ...(guardianUserId ? { guardianUserId } : {}),
      programId: req.body.programId || "default-program",
      birthDate: req.body.birthDate || "2015-01-01",
    };

    const parsed = schemas.participantCreateSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ValidationError("Invalid participant payload.", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const created = await service.createParticipant(req.principal, parsed.data);
    if (parsed.data.guardianEmail) {
      const email = parsed.data.guardianEmail;
      const now = new Date().toISOString();
      const [participant, organization, canonicalUser, legacyUser] =
        await Promise.all([
          db.doc(`participants/${created.id}`).get(),
          db.doc(`organizations/${orgId}`).get(),
          db
            .collection("users")
            .where("emailNormalized", "==", email)
            .limit(1)
            .get(),
          db.collection("users").where("email", "==", email).limit(1).get(),
        ]);
      const existing = canonicalUser.empty ? legacyUser : canonicalUser;
      const guardianUserId = existing.docs[0]?.id;
      const hash = createHash("sha256")
        .update(email)
        .digest("hex")
        .slice(0, 12);
      const linkId = `${guardianUserId || `pending_${hash}`}_${created.id}`;
      const batch = db.batch();
      batch.set(db.doc(`parentChildLinks/${linkId}`), {
        id: linkId,
        organizationId: orgId,
        participantId: created.id,
        parentUid: guardianUserId ?? null,
        guardianUserId: guardianUserId ?? null,
        guardianEmail: email,
        relationship: "parent",
        status: guardianUserId ? "active" : "pending_acceptance",
        createdAt: now,
        updatedAt: now,
      });
      batch.update(participant.ref, {
        guardianEmail: email,
        ...(guardianUserId ? { guardianUserId } : {}),
        updatedAt: now,
      });
      batch.create(db.collection("mailQueue").doc(), {
        to: email,
        template: "guardian_invitation",
        status: "queued",
        organizationName:
          organization.get("name") ||
          organization.get("displayName") ||
          "Your Organization",
        participantName:
          participant.get("approvedDisplayName") ||
          participant.get("displayName") ||
          "Your Child",
        joinUrl: `https://groundedandfruitful.netlify.app/parent-onboarding?email=${encodeURIComponent(email)}&orgId=${encodeURIComponent(orgId)}`,
        data: {
          organizationName:
            organization.get("name") ||
            organization.get("displayName") ||
            "Your Organization",
          participantName:
            participant.get("approvedDisplayName") ||
            participant.get("displayName") ||
            "Your Child",
          joinUrl: `https://groundedandfruitful.netlify.app/parent-onboarding?email=${encodeURIComponent(email)}&orgId=${encodeURIComponent(orgId)}`,
        },
        createdAt: now,
      });
      await batch.commit();
    }
    return created;
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
