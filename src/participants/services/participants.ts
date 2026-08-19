import type { Firestore } from "firebase-admin/firestore";
import {
  requireMentorOfChild,
  requireParentOf,
  requireAnyRole,
  requireChildParticipant,
  type Principal,
} from "../../auth/authorization.js";
import { ParticipantRepository } from "../repositories/participants.js";
export class ParticipantService {
  constructor(
    private db: Firestore,
    private repo: ParticipantRepository,
  ) {}
  async get(principal: Principal | undefined, id: string) {
    const p = requireAnyRole(principal, [
      "child",
      "parent",
      "mentor",
      "admin",
      "super_admin",
    ]);
    if (p.role === "child") await requireChildParticipant(this.db, p, id);
    if (p.role === "parent") await requireParentOf(this.db, p, id);
    if (p.role === "mentor") await requireMentorOfChild(this.db, p, id);
    return this.repo.get(id);
  }
}
