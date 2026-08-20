import type { Firestore } from "firebase-admin/firestore";
import {
  requireMentorOfChild,
  requireParentOf,
  requireAnyRole,
  requireChildParticipant,
  type Principal,
} from "../../auth/authorization.js";
import { AuthorizationError } from "../../shared/errors.js";
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
      "observer",
      "admin",
      "super_admin",
    ]);
    if (p.role === "child") await requireChildParticipant(this.db, p, id);
    if (p.role === "parent") await requireParentOf(this.db, p, id);
    if (p.role === "mentor") await requireMentorOfChild(this.db, p, id);
    const participant = await this.db.doc(`participants/${id}`).get();
    const organizationId = participant.get("organizationId") as
      | string
      | undefined;
    if (
      (p.role === "admin" || p.role === "super_admin") &&
      (!organizationId || !p.organizationIds.includes(organizationId))
    )
      throw new AuthorizationError();
    if (p.role === "observer") {
      const grant = await this.db.doc(`observerGrants/${p.uid}_${id}`).get();
      if (
        !grant.exists ||
        grant.get("status") !== "active" ||
        grant.get("organizationId") !== organizationId ||
        !p.organizationIds.includes(String(organizationId))
      )
        throw new AuthorizationError();
    }
    return this.repo.get(id);
  }
}
