import { Router } from "express";
import { db } from "../../config/firebase.js";
import { requireAdmin, requireAuthenticated } from "../../middleware/authorize.js";
import { validateBody } from "../../middleware/validate.js";
import { ValidationError } from "../../shared/errors.js";
import { pointAdjustmentSchema, sourceAwardSchema, reconciliationSchema, reconciliationRollbackSchema } from "../schemas.js";
import { PointAdjustmentService } from "../adjustment-service.js";
import { SourceCompletionService } from "../completion-service.js";
import { ReconciliationService } from "../reconciliation-service.js";
import type { CompletionSourceType } from "../domain.js";

const router = Router(), adjustmentService = new PointAdjustmentService(db), reconciliation = new ReconciliationService(db);
const key = (header: string | undefined) => { if (!header || !/^[A-Za-z0-9:_-]{1,200}$/.test(header)) throw new ValidationError("A valid Idempotency-Key header is required."); return header; };
const sources: ReadonlyArray<[string, CompletionSourceType]> = [
  ["daily-check-ins", "daily_checkin"], ["gratitude", "gratitude"], ["character-assessments", "character_assessment"],
  ["bible-activities", "bible_activity"], ["family-activities", "family_activity"], ["reading", "reading"],
  ["project-milestones", "project_milestone"], ["project-completions", "project_completion"], ["academic-sessions", "academic_session"],
  ["observation-bonuses", "character_observation_bonus"],
];
for (const [path, type] of sources) router.post(`/sources/${path}/completions`, requireAuthenticated, validateBody(sourceAwardSchema), async (req, res, next) => {
  try { const result = await new SourceCompletionService(db, type).record(req.principal, req.body, key(req.header("idempotency-key"))); res.status(result.created ? 201 : 200).json({ data: { id: result.entry.id, points: result.entry.points, created: result.created } }); } catch (error) { next(error); }
});

router.post("/adjustments", requireAdmin, validateBody(pointAdjustmentSchema), async (req, res, next) => {
  try { const result = await adjustmentService.record(req.principal, req.body, key(req.header("idempotency-key"))); res.status(result.created ? 201 : 200).json({ data: { id: result.entry.id, points: result.entry.points, originalEntryId: result.entry.originalEntryId ?? null, created: result.created } }); } catch (error) { next(error); }
});
router.post("/reconciliations", requireAdmin, validateBody(reconciliationSchema), async (req, res, next) => { try { res.status(200).json({ data: await reconciliation.run(req.principal, req.body) }); } catch (e) { next(e); } });
router.post("/reconciliations/rollback", requireAdmin, validateBody(reconciliationRollbackSchema), async (req, res, next) => { try { res.status(200).json({ data: await reconciliation.rollback(req.principal, req.body) }); } catch (e) { next(e); } });
export default router;
