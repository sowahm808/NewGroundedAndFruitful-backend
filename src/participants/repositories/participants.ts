import type { Firestore } from "firebase-admin/firestore";
import { NotFoundError } from "../../shared/errors.js";
export class ParticipantRepository {
  constructor(private db: Firestore) {}
  async get(id: string) {
    const snap = await this.db.doc(`participants/${id}`).get();
    if (!snap.exists) throw new NotFoundError();
    const data = snap.data() ?? {};
    return {
      id: snap.id,
      displayName: data.displayName,
      activeTeamId: data.activeTeamId,
    };
  }
}
