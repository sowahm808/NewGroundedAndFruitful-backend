import { Router, type Request } from "express";
import { db } from "../../config/firebase.js";
import { requireCapability } from "../../middleware/authorize.js";
import { ValidationError } from "../../shared/errors.js";
import {
  characterPatchSchema,
  characterQuerySchema,
  characterSelectionSchema,
  childCredentialsSchema,
  childQuerySchema,
  familyActivityQuerySchema,
  familyCompletionCommandSchema,
  idSchema,
  idempotencyKeySchema,
  observationSchema,
  observationQuerySchema,
  notificationQuerySchema,
  participationQuerySchema,
  reportQuerySchema,
  supportListQuerySchema,
  supportRequestSchema,
} from "../schemas.js";
import { ParentService } from "../service.js";

const router = Router();
const service = new ParentService(db);
router.use(requireCapability("parent.children.read"));
const principal = (req: Request) => req.principal!;
const parse = <T>(
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { flatten(): unknown } };
  },
  value: unknown,
): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ValidationError("Invalid request.", result.error.flatten());
  return result.data;
};
const idempotencyKey = (req: Request) =>
  parse(idempotencyKeySchema, req.headers["idempotency-key"]);
const envelope = <T>(data: T) => ({ data });

router.get("/dashboard", async (req, res, next) => {
  try {
    res.json(envelope(await service.dashboard(principal(req))));
  } catch (e) {
    next(e);
  }
});
router.get("/notifications", async (req, res, next) => {
  try {
    res.json(
      await service.notifications(
        principal(req),
        parse(notificationQuerySchema, req.query),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/children", async (req, res, next) => {
  try {
    res.json(
      await service.children(
        principal(req),
        parse(childQuerySchema, req.query),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/family-code", async (req, res, next) => {
  try {
    res.json(envelope(await service.familyCode(principal(req))));
  } catch (e) {
    next(e);
  }
});
router.get("/children/:childId", async (req, res, next) => {
  try {
    res.json(
      envelope(
        await service.child(
          principal(req),
          parse(idSchema, req.params.childId),
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/participation", async (req, res, next) => {
  try {
    const input = parse(participationQuerySchema, req.query);
    res.json(
      envelope(
        await service.participation(
          principal(req),
          input.childId,
          input.quarterId,
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.post("/children/:childId/credentials", async (req, res, next) => {
  try {
    res.json(
      envelope(
        await service.setChildCredentials(
          principal(req),
          parse(idSchema, req.params.childId),
          parse(childCredentialsSchema, req.body),
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/observations", async (req, res, next) => {
  try {
    res.json(
      await service.observations(
        principal(req),
        parse(observationQuerySchema, req.query),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.post("/observations", async (req, res, next) => {
  try {
    const result = await service.createObservation(
      principal(req),
      parse(observationSchema, req.body),
      idempotencyKey(req),
    );
    res.status(result.created ? 201 : 200).json(envelope(result));
  } catch (e) {
    next(e);
  }
});
router.get("/observations/:id", async (req, res, next) => {
  try {
    res.json(
      envelope(
        await service.observation(
          principal(req),
          parse(idSchema, req.params.id),
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/character/qualities", async (req, res, next) => {
  try {
    res.json(await service.qualities(principal(req)));
  } catch (e) {
    next(e);
  }
});
router.get("/character", async (req, res, next) => {
  try {
    const input = parse(characterQuerySchema, req.query);
    res.json(
      envelope(
        await service.selection(principal(req), input.childId, input.quarterId),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/character/selection", async (req, res, next) => {
  try {
    const input = parse(characterQuerySchema, req.query);
    res.json(
      await service.selection(principal(req), input.childId, input.quarterId),
    );
  } catch (e) {
    next(e);
  }
});
router.post("/character/selection", async (req, res, next) => {
  try {
    res.json(
      await service.setSelection(
        principal(req),
        parse(characterPatchSchema, req.body),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.patch("/character", async (req, res, next) => {
  try {
    res.json(
      envelope(
        await service.setSelection(
          principal(req),
          parse(characterPatchSchema, req.body),
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get(
  "/character/selections/:childId/:quarterId",
  async (req, res, next) => {
    try {
      res.json(
        envelope(
          await service.selection(
            principal(req),
            parse(idSchema, req.params.childId),
            parse(idSchema, req.params.quarterId),
          ),
        ),
      );
    } catch (e) {
      next(e);
    }
  },
);
router.put("/character/selections", async (req, res, next) => {
  try {
    res.json(
      envelope(
        await service.setSelection(
          principal(req),
          parse(characterSelectionSchema, req.body),
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/family-activities", async (req, res, next) => {
  try {
    const childId = parse(idSchema, req.query.childId);
    res.json(await service.familyActivities(principal(req), childId));
  } catch (e) {
    next(e);
  }
});
router.get("/family/activities", async (req, res, next) => {
  try {
    const input = parse(familyActivityQuerySchema, req.query);
    res.json(
      await service.familyActivities(principal(req), input.childId, input),
    );
  } catch (e) {
    next(e);
  }
});
router.post(
  "/family/activities/:activityId/completions",
  async (req, res, next) => {
    try {
      // The deterministic activity/child document is the idempotency boundary;
      // the header is still required so clients never accidentally issue an unsafe retry.
      idempotencyKey(req);
      const input = parse(familyCompletionCommandSchema, req.body);
      const result = await service.completeFamilyActivity(
        principal(req),
        input.childId,
        parse(idSchema, req.params.activityId),
      );
      res.status(result.created ? 201 : 200).json(envelope(result));
    } catch (e) {
      next(e);
    }
  },
);
// Compatibility endpoint used by the academic-support request form. Academic
// support configuration is currently the set of active, tenant-scoped support
// categories, so keep both URLs backed by the same service method.
router.get("/academic-support/configuration", async (req, res, next) => {
  try {
    res.json(await service.supportCategories(principal(req)));
  } catch (e) {
    next(e);
  }
});
router.get("/academic-support/requests", async (req, res, next) => {
  try {
    res.json(
      await service.supportList(
        principal(req),
        parse(supportListQuerySchema, req.query),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.post("/academic-support/requests", async (req, res, next) => {
  try {
    const result = await service.createSupport(
      principal(req),
      parse(supportRequestSchema, req.body),
      idempotencyKey(req),
    );
    res.status(result.created ? 201 : 200).json(envelope(result));
  } catch (e) {
    next(e);
  }
});
router.get("/academic-support/requests/:requestId", async (req, res, next) => {
  try {
    res.json(
      envelope(
        await service.supportDetail(
          principal(req),
          parse(idSchema, req.params.requestId),
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/support/categories", async (req, res, next) => {
  try {
    res.json(await service.supportCategories(principal(req)));
  } catch (e) {
    next(e);
  }
});
router.get("/support/requests", async (req, res, next) => {
  try {
    res.json(
      await service.supportList(
        principal(req),
        parse(supportListQuerySchema, req.query),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.post("/support/requests", async (req, res, next) => {
  try {
    const result = await service.createSupport(
      principal(req),
      parse(supportRequestSchema, req.body),
      idempotencyKey(req),
    );
    res.status(result.created ? 201 : 200).json(envelope(result));
  } catch (e) {
    next(e);
  }
});
router.get("/support/requests/:id", async (req, res, next) => {
  try {
    res.json(
      envelope(
        await service.supportDetail(
          principal(req),
          parse(idSchema, req.params.id),
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/reports/:childId", async (req, res, next) => {
  try {
    res.json(
      envelope(
        await service.report(
          principal(req),
          parse(idSchema, req.params.childId),
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/reports", async (req, res, next) => {
  try {
    const input = parse(reportQuerySchema, req.query);
    res.json(envelope(await service.report(principal(req), input.childId)));
  } catch (e) {
    next(e);
  }
});
router.get("/teams/:teamId/progress", async (req, res, next) => {
  try {
    res.json(
      envelope(
        await service.teamProgress(
          principal(req),
          parse(idSchema, req.params.teamId),
          parse(idSchema, req.query.quarterId),
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
export default router;
