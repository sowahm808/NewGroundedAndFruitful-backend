// src/points/routes/index.ts
import { Router } from "express";
import { db } from "../../config/firebase.js";
import {
  requireAdmin,
  requireAuthenticated,
} from "../../middleware/authorize.js";
import { validateBody } from "../../middleware/validate.js";
import { ValidationError } from "../../shared/errors.js";
import { awardSchema, pointAdjustmentSchema } from "../schemas.js";
import { PointAdjustmentService } from "../adjustment-service.js";
import { SourceCompletionService } from "../completion-service.js";

const router = Router();
const adjustmentService = new PointAdjustmentService(db);

router.post(
  "/completions",
  requireAuthenticated,
  validateBody(awardSchema),
  async (req, res, next) => {
    try {
      const key = req.header("idempotency-key");
      if (!key || !/^[A-Za-z0-9:_-]{1,200}$/.test(key))
        throw new ValidationError(
          "A valid Idempotency-Key header is required.",
        );

      const { sourceType, participantId, sourceId } = req.body;
      const service = new SourceCompletionService(db, sourceType);
      const result = await service.record(
        req.principal,
        { participantId, sourceId },
        key,
      );

      res.status(result.created ? 201 : 200).json({
        data: {
          id: result.entry.id,
          points: result.entry.points,
          created: result.created,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  "/adjustments",
  requireAdmin,
  validateBody(pointAdjustmentSchema),
  async (req, res, next) => {
    try {
      const key = req.header("idempotency-key");
      if (!key || !/^[A-Za-z0-9:_-]{1,200}$/.test(key))
        throw new ValidationError(
          "A valid Idempotency-Key header is required.",
        );
      const result = await adjustmentService.record(
        req.principal,
        req.body,
        key,
      );
      res.status(result.created ? 201 : 200).json({
        data: {
          id: result.entry.id,
          points: result.entry.points,
          originalEntryId: result.entry.originalEntryId ?? null,
          created: result.created,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;