import { Router } from "express";
import { db } from "../../config/firebase.js";
import { requireAuthenticated } from "../../middleware/authorize.js";
import { validateBody } from "../../middleware/validate.js";
import { ValidationError } from "../../shared/errors.js";
import { awardSchema } from "../schemas.js";
import { PointRepository } from "../repository.js";
const router = Router(),
  repo = new PointRepository(db);
router.post(
  "/completions",
  requireAuthenticated,
  validateBody(awardSchema),
  async (req, res, next) => {
    try {
      const key = req.header("idempotency-key");
      if (!key || key.length > 200)
        throw new ValidationError(
          "A valid Idempotency-Key header is required.",
        );
      const p = req.principal!;
      if (
        p.role === "child" &&
        p.token.participantId !== req.body.participantId &&
        p.uid !== req.body.participantId
      )
        throw new ValidationError(
          "Participant does not match authenticated identity.",
        );
      const result = await repo.award(
        { ...req.body, awardedBy: p.uid, idempotencyKey: key },
        10,
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
export default router;
