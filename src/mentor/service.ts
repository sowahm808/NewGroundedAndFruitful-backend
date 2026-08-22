/* eslint-disable @typescript-eslint/no-unsafe-return */
import type {
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { AuthorizationError, NotFoundError } from "../shared/errors.js";

type Principal = { uid: string; organizationIds: readonly string[] };
type Data = Record<string, unknown>;
const activeNow = (doc: QueryDocumentSnapshot, now = Date.now()) => {
  const effective = doc.get("effectiveAt");
  const expires = doc.get("expiresAt");
  return (
    doc.get("status") === "active" &&
    effective instanceof Timestamp &&
    effective.toMillis() <= now &&
    (!(expires instanceof Timestamp) || expires.toMillis() > now)
  );
};
const pick = (doc: QueryDocumentSnapshot, fields: readonly string[]) =>
  Object.fromEntries(
    [["id", doc.id], ...fields.map((key) => [key, doc.get(key)])].filter(
      ([, value]) => value !== undefined,
    ),
  );

export class MentorService {
  constructor(private readonly db: Firestore) {}
  private async assignment(principal: Principal, teamId: string) {
    const snap = await this.db
      .collection("teamMembers")
      .where("teamId", "==", teamId)
      .where("userId", "==", principal.uid)
      .where("role", "==", "mentor")
      .limit(5)
      .get();
    const assignment = snap.docs.find((doc) => activeNow(doc));
    if (
      !assignment ||
      !principal.organizationIds.includes(
        String(assignment.get("organizationId")),
      )
    )
      throw new NotFoundError();
    return assignment;
  }
  private async participant(principal: Principal, participantId: string) {
    const participant = await this.db
      .doc(`participants/${participantId}`)
      .get();
    if (!participant.exists) throw new NotFoundError();
    const teamId = participant.get("activeTeamId") ?? participant.get("teamId");
    if (typeof teamId !== "string") throw new NotFoundError();
    await this.assignment(principal, teamId);
    if (
      !principal.organizationIds.includes(
        String(participant.get("organizationId")),
      )
    )
      throw new AuthorizationError();
    return { participant, teamId };
  }
  async teams(principal: Principal) {
    const assignments = await this.db
      .collection("teamMembers")
      .where("userId", "==", principal.uid)
      .where("role", "==", "mentor")
      .get();
    return Promise.all(
      assignments.docs
        .filter(
          (d) =>
            activeNow(d) &&
            principal.organizationIds.includes(String(d.get("organizationId"))),
        )
        .map(async (a) => {
          const team = await this.db
            .doc(`teams/${String(a.get("teamId"))}`)
            .get();
          return team.exists
            ? {
                id: team.id,
                name: team.get("approvedDisplayName") ?? team.get("name") ?? "",
                status: team.get("status"),
              }
            : null;
        }),
    ).then((items) => items.filter(Boolean));
  }
  async team(principal: Principal, teamId: string) {
    await this.assignment(principal, teamId);
    const team = await this.db.doc(`teams/${teamId}`).get();
    if (!team.exists) throw new NotFoundError();
    const members = await this.db
      .collection("teamMembers")
      .where("teamId", "==", teamId)
      .where("role", "==", "participant")
      .where("status", "==", "active")
      .get();
    const participants = await Promise.all(
      members.docs.filter(activeNow).map(async (m) => {
        const p = await this.db
          .doc(`participants/${String(m.get("participantId"))}`)
          .get();
        return p.exists
          ? {
              id: p.id,
              approvedDisplayName: p.get("approvedDisplayName") ?? "",
              status: p.get("status"),
            }
          : null;
      }),
    );
    return {
      id: team.id,
      name: team.get("approvedDisplayName") ?? team.get("name") ?? "",
      participants: participants.filter(Boolean),
    };
  }
  private async scoped(
    principal: Principal,
    participantId: string,
    collection: string,
    quarterId?: string,
  ) {
    await this.participant(principal, participantId);
    let query = this.db
      .collection(collection)
      .where("participantId", "==", participantId);
    if (quarterId) query = query.where("quarterId", "==", quarterId);
    return query.get();
  }
  async progress(p: Principal, participantId: string, quarterId?: string) {
    const [participation, reading, projects] = await Promise.all([
      this.scoped(p, participantId, "participationCompletions", quarterId),
      this.scoped(p, participantId, "readingResponses", quarterId),
      this.scoped(p, participantId, "projects", quarterId),
    ]);
    return {
      participantId,
      participationCompleted: participation.size,
      readingCompleted: reading.size,
      projects: projects.docs.map((d) =>
        pick(d, ["status", "quarterId", "title"]),
      ),
    };
  }
  async participation(p: Principal, participantId: string, quarterId?: string) {
    const s = await this.scoped(
      p,
      participantId,
      "participationCompletions",
      quarterId,
    );
    return s.docs.map((d) =>
      pick(d, ["activityId", "quarterId", "week", "completedAt"]),
    );
  }
  async reading(p: Principal, participantId: string, quarterId?: string) {
    const s = await this.scoped(
      p,
      participantId,
      "readingResponses",
      quarterId,
    );
    return s.docs.map((d) =>
      pick(d, ["assignmentId", "bookId", "quarterId", "status", "completedAt"]),
    );
  }
  async create(p: Principal, collection: string, event: string, input: Data) {
    const { participant, teamId } = await this.participant(
      p,
      String(input.participantId),
    );
    const ref = this.db.collection(collection).doc();
    await ref.create({
      ...input,
      teamId,
      organizationId: participant.get("organizationId"),
      mentorUserId: p.uid,
      status: collection === "mentorNotes" ? "pending" : "active",
      createdAt: FieldValue.serverTimestamp(),
    });
    await this.db.collection("auditLogs").add({
      event,
      actorId: p.uid,
      organizationId: participant.get("organizationId"),
      subject: { id: ref.id, participantId: input.participantId },
      createdAt: FieldValue.serverTimestamp(),
    });
    return {
      id: ref.id,
      status: collection === "mentorNotes" ? "pending" : "active",
    };
  }
  async notes(p: Principal, participantId: string) {
    const s = await this.scoped(p, participantId, "mentorNotes");
    return s.docs
      .filter((d) => d.get("status") === "approved")
      .map((d) => pick(d, ["body", "approvedAt", "createdAt"]));
  }
}
