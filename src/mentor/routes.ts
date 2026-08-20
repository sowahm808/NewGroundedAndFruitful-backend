import { Router, type Request, type RequestHandler } from "express";
import { db } from "../config/firebase.js";
import { requireAnyRole } from "../middleware/authorize.js";
import { ValidationError } from "../shared/errors.js";
import { idSchema } from "../shared/validation.js";
import * as schemas from "./schemas.js";
import { MentorService } from "./service.js";
const router = Router(),
  service = new MentorService(db);
router.use(requireAnyRole("mentor"));
const parse = <T>(
  s: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  v: unknown,
) => {
  const r = s.safeParse(v);
  if (!r.success) throw new ValidationError();
  return r.data;
};
const run = (fn: (r: Request) => Promise<unknown>, status = 200) =>
  (async (req, res, next) => {
    try {
      res.status(status).json({ data: await fn(req) });
    } catch (e) {
      next(e);
    }
  }) satisfies RequestHandler;
router.get(
  "/teams",
  run((r) => service.teams(r.principal!)),
);
router.get(
  "/teams/:teamId",
  run((r) => service.team(r.principal!, parse(idSchema, r.params.teamId))),
);
router.get(
  "/progress",
  run((r) => {
    const q = parse(schemas.mentorParticipantQuerySchema, r.query);
    return service.progress(r.principal!, q.participantId, q.quarterId);
  }),
);
router.get(
  "/participation",
  run((r) => {
    const q = parse(schemas.mentorParticipantQuerySchema, r.query);
    return service.participation(r.principal!, q.participantId, q.quarterId);
  }),
);
router.get(
  "/reading",
  run((r) => {
    const q = parse(schemas.mentorParticipantQuerySchema, r.query);
    return service.reading(r.principal!, q.participantId, q.quarterId);
  }),
);
router.post(
  "/project-guidance",
  run(
    (r) =>
      service.create(
        r.principal!,
        "projectGuidance",
        "mentor.project_guidance.created",
        parse(schemas.guidanceSchema, r.body),
      ),
    201,
  ),
);
router.post(
  "/encouragement",
  run(
    (r) =>
      service.create(
        r.principal!,
        "encouragements",
        "mentor.encouragement.created",
        parse(schemas.encouragementSchema, r.body),
      ),
    201,
  ),
);
router.get(
  "/notes",
  run((r) =>
    service.notes(r.principal!, parse(idSchema, r.query.participantId)),
  ),
);
router.post(
  "/notes",
  run(
    (r) =>
      service.create(
        r.principal!,
        "mentorNotes",
        "mentor.note.submitted",
        parse(schemas.noteSchema, r.body),
      ),
    201,
  ),
);
export default router;
