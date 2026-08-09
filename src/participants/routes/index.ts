import { Router } from "express";
import { db } from "../../config/firebase.js";
import { requireAuthenticated } from "../../middleware/authorize.js";
import { idSchema } from "../../shared/validation.js";
import { ValidationError } from "../../shared/errors.js";
import { ParticipantRepository } from "../repositories/participants.js";
import { ParticipantService } from "../services/participants.js";
const router = Router(),
  service = new ParticipantService(db, new ParticipantRepository(db));
router.get("/:id", requireAuthenticated, async (req, res, next) => {
  try {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) throw new ValidationError();
    res.json({ data: await service.get(req.principal, parsed.data) });
  } catch (e) {
    next(e);
  }
});
export default router;
