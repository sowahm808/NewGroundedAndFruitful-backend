import { Router } from "express";
import { db } from "../../config/firebase.js";
import { requireAnyRole } from "../../middleware/authorize.js";
import { ValidationError } from "../../shared/errors.js";
import {
  characterSelectionSchema,
  childQuerySchema,
  familyCompletionSchema,
  idSchema,
  listSchema,
  observationSchema,
  supportRequestSchema,
} from "../schemas.js";
import { ParentService } from "../service.js";

const router = Router();
const service = new ParentService(db);
router.use(requireAnyRole("parent"));
const principal = (req: Express.Request) => req.principal!;
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

router.get("/dashboard", async (req, res, next) => {
  try {
    res.json(await service.dashboard(principal(req)));
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
router.get("/children/:childId", async (req, res, next) => {
  try {
    res.json(
      await service.child(principal(req), parse(idSchema, req.params.childId)),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/observations", async (req, res, next) => {
  try {
    res.json(
      await service.observations(principal(req), parse(listSchema, req.query)),
    );
  } catch (e) {
    next(e);
  }
});
router.post("/observations", async (req, res, next) => {
  try {
    res
      .status(201)
      .json(
        await service.createObservation(
          principal(req),
          parse(observationSchema, req.body),
        ),
      );
  } catch (e) {
    next(e);
  }
});
router.get("/observations/:id", async (req, res, next) => {
  try {
    res.json(
      await service.observation(principal(req), parse(idSchema, req.params.id)),
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
router.get(
  "/character/selections/:childId/:quarterId",
  async (req, res, next) => {
    try {
      res.json(
        await service.selection(
          principal(req),
          parse(idSchema, req.params.childId),
          parse(idSchema, req.params.quarterId),
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
      await service.setSelection(
        principal(req),
        parse(characterSelectionSchema, req.body),
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
router.post("/family-activities/completions", async (req, res, next) => {
  try {
    const body = parse(familyCompletionSchema, req.body);
    const result = await service.completeFamilyActivity(
      principal(req),
      body.childId,
      body.activityId,
    );
    res.status(result.created ? 201 : 200).json(result);
  } catch (e) {
    next(e);
  }
});
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
      await service.supportList(principal(req), parse(listSchema, req.query)),
    );
  } catch (e) {
    next(e);
  }
});
router.post("/support/requests", async (req, res, next) => {
  try {
    res
      .status(201)
      .json(
        await service.createSupport(
          principal(req),
          parse(supportRequestSchema, req.body),
        ),
      );
  } catch (e) {
    next(e);
  }
});
router.get("/support/requests/:id", async (req, res, next) => {
  try {
    res.json(
      await service.supportDetail(
        principal(req),
        parse(idSchema, req.params.id),
      ),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/reports/:childId", async (req, res, next) => {
  try {
    res.json(
      await service.report(principal(req), parse(idSchema, req.params.childId)),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/teams/:teamId/progress", async (req, res, next) => {
  try {
    res.json(
      await service.teamProgress(
        principal(req),
        parse(idSchema, req.params.teamId),
        parse(idSchema, req.query.quarterId),
      ),
    );
  } catch (e) {
    next(e);
  }
});
export default router;
