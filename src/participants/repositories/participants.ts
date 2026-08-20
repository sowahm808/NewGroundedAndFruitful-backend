import type { Firestore } from "firebase-admin/firestore";
import { NotFoundError } from "../../shared/errors.js";
import { z } from "zod";
const participantDocument = z.object({
  displayName: z.string(),
  activeTeamId: z.string().optional(),
  status: z.string(),
  organizationId: z.string().min(1),
  programId: z.string().optional(),
  version: z.number().int().nonnegative(),
}).passthrough();
export class ParticipantRepository {
  constructor(private db: Firestore) {}
  async get(id: string) {
    const snap = await this.db.doc(`participants/${id}`).get();
    if (!snap.exists) throw new NotFoundError();
    const data = participantDocument.parse(snap.data());
    return {
      id: snap.id,
      displayName: data.displayName,
      activeTeamId: data.activeTeamId,
      status: data.status,
      organizationId: data.organizationId,
      programId: data.programId,
      version: data.version,
    };
  }
}
