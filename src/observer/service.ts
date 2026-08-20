import type {
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { AuthorizationError, NotFoundError } from "../shared/errors.js";
type Principal = { uid: string; organizationIds: readonly string[] };
const current = (d: QueryDocumentSnapshot) =>
  d.get("status") === "active" &&
  d.get("effectiveAt") instanceof Timestamp &&
  (d.get("effectiveAt") as Timestamp).toMillis() <= Date.now() &&
  (!(d.get("expiresAt") instanceof Timestamp) ||
    (d.get("expiresAt") as Timestamp).toMillis() > Date.now());
export class ObserverService {
  constructor(private readonly db: Firestore) {}
  private async grant(p: Principal, participantId: string) {
    const grants = await this.db
      .collection("observerGrants")
      .where("userId", "==", p.uid)
      .where("participantId", "==", participantId)
      .limit(5)
      .get();
    const grant = grants.docs.find(current);
    if (!grant) throw new NotFoundError();
    const oid = String(grant.get("organizationId"));
    if (!p.organizationIds.includes(oid)) throw new AuthorizationError();
    return grant;
  }
  async subjects(p: Principal) {
    const grants = await this.db
      .collection("observerGrants")
      .where("userId", "==", p.uid)
      .get();
    const permitted = grants.docs.filter(
      (g) =>
        current(g) &&
        p.organizationIds.includes(String(g.get("organizationId"))),
    );
    return Promise.all(
      permitted.map(async (g) => {
        const participantId = String(g.get("participantId")),
          participant = await this.db
            .doc(`participants/${participantId}`)
            .get();
        if (
          !participant.exists ||
          participant.get("organizationId") !== g.get("organizationId")
        )
          return null;
        return {
          participantId,
          approvedDisplayName: participant.get("approvedDisplayName") ?? "",
          permissions: Array.isArray(g.get("subjectIds"))
            ? g.get("subjectIds")
            : [],
        };
      }),
    ).then((v) => v.filter(Boolean));
  }
  async submit(
    p: Principal,
    input: {
      participantId: string;
      subjectId: string;
      observedAt: string;
      description: string;
    },
  ) {
    const grant = await this.grant(p, input.participantId),
      allowed = grant.get("subjectIds");
    if (Array.isArray(allowed) && !allowed.includes(input.subjectId))
      throw new AuthorizationError();
    const ref = this.db.collection("observerObservations").doc();
    await ref.create({
      ...input,
      observerUserId: p.uid,
      organizationId: grant.get("organizationId"),
      observedAt: Timestamp.fromDate(new Date(input.observedAt)),
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
    await this.db.collection("auditLogs").add({
      event: "observer.observation.submitted",
      actorId: p.uid,
      organizationId: grant.get("organizationId"),
      subject: { observationId: ref.id, participantId: input.participantId },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { id: ref.id, status: "pending" };
  }
  async history(
    p: Principal,
    filter: {
      participantId?: string | undefined;
      status?: string | undefined;
    },
  ) {
    if (filter.participantId) await this.grant(p, filter.participantId);
    let q = this.db
      .collection("observerObservations")
      .where("observerUserId", "==", p.uid);
    if (filter.participantId)
      q = q.where("participantId", "==", filter.participantId);
    if (filter.status) q = q.where("status", "==", filter.status);
    const snap = await q.get();
    return snap.docs
      .filter((d) =>
        p.organizationIds.includes(String(d.get("organizationId"))),
      )
      .map((d) => ({
        id: d.id,
        participantId: d.get("participantId"),
        subjectId: d.get("subjectId"),
        description: d.get("description"),
        observedAt: d.get("observedAt"),
        status: d.get("status"),
        moderatedAt: d.get("moderatedAt") ?? null,
      }));
  }
  async status(p: Principal, id: string) {
    const d = await this.db.doc(`observerObservations/${id}`).get();
    if (
      !d.exists ||
      d.get("observerUserId") !== p.uid ||
      !p.organizationIds.includes(String(d.get("organizationId")))
    )
      throw new NotFoundError();
    return {
      id: d.id,
      status: d.get("status"),
      moderatedAt: d.get("moderatedAt") ?? null,
    };
  }
}
