import { createHash, randomUUID } from "node:crypto";
import {
  FieldValue,
  type Firestore,
  type Timestamp,
} from "firebase-admin/firestore";
import type { Principal } from "../auth/authorization.js";
import {
  resolveChildContext,
  localDateIn,
  quarterAcceptsSubmissions,
} from "../child/context.js";
import { AppError } from "../shared/errors.js";
import type { z } from "zod";
import type { responseInputSchema } from "./domain.js";
type Input = z.infer<typeof responseInputSchema>;
const err = (status: number, code: string, message: string) =>
  new AppError(status, code, message);
const key = (...p: string[]) =>
  createHash("sha256").update(p.join("\0")).digest("base64url");
const iso = (v: unknown) =>
  v && typeof v === "object" && "toDate" in v
    ? (v as Timestamp).toDate().toISOString()
    : null;
export class BibleChildService {
  constructor(
    private readonly db: Firestore,
    private readonly clock = () => new Date(),
  ) {}
  private async scope(principal: Principal | undefined) {
    return resolveChildContext(this.db, principal, this.clock());
  }
  private childActivity(
    doc:
      | FirebaseFirestore.QueryDocumentSnapshot
      | FirebaseFirestore.DocumentSnapshot,
  ) {
    const questions = Array.isArray(doc.get("questions"))
      ? (doc.get("questions") as Array<Record<string, unknown>>)
      : [];
    return {
      id: doc.id,
      localDate: String(doc.get("localDate")),
      scriptureReference: String(doc.get("scriptureReference")),
      title: String(doc.get("title")),
      instructions: String(doc.get("instructions") ?? ""),
      responseType: "multiple_choice" as const,
      questions: questions.map((q) => ({
        id: String(q.id),
        position: Number(q.position),
        prompt: String(q.prompt),
        choices: Array.isArray(q.choices)
          ? q.choices.map((c) => {
              const x = c as Record<string, unknown>;
              return {
                id: String(x.id),
                label: String(x.label),
                text: String(x.text),
              };
            })
          : [],
      })),
    };
  }
  async today(principal: Principal | undefined) {
    const { context: c, quarter } = await this.scope(principal),
      localDate = localDateIn(this.clock(), c.timezone),
      calculatedAt = this.clock().toISOString();
    if (!quarter)
      return {
        available: false,
        reason: "no_active_quarter",
        activity: null,
        responseStatus: "not_started",
        quarterId: null,
        localDate,
        calculatedAt,
      };
    const snap = await this.db
      .collection("bibleActivities")
      .where("organizationId", "==", c.organizationId)
      .where("quarterId", "==", quarter.id)
      .where("localDate", "==", localDate)
      .where("status", "==", "published")
      .limit(2)
      .get();
    if (snap.size > 1)
      throw err(
        503,
        "BIBLE_CONTENT_DATE_CONFLICT",
        "Bible content configuration is ambiguous.",
      );
    const activity = snap.docs[0];
    if (!activity)
      return {
        available: false,
        reason: "no_assignment",
        activity: null,
        responseStatus: "not_started",
        quarterId: quarter.id,
        localDate,
        calculatedAt,
      };
    const response = await this.db
      .doc(`bibleResponses/${key(quarter.id, activity.id, c.participantId)}`)
      .get();
    return {
      available: true,
      reason: null,
      activity: this.childActivity(activity),
      responseStatus: response.exists
        ? String(response.get("status"))
        : "not_started",
      version: response.exists ? Number(response.get("version")) : 0,
      quarterId: quarter.id,
      localDate,
      calculatedAt,
    };
  }
  async history(principal: Principal | undefined) {
    const { context: c } = await this.scope(principal);
    const snap = await this.db
      .collection("bibleResponses")
      .where("organizationId", "==", c.organizationId)
      .where("participantId", "==", c.participantId)
      .where("status", "==", "completed")
      .orderBy("completedAt", "desc")
      .limit(50)
      .get();
    return {
      items: snap.docs.map((d) => ({
        activityId: d.get("activityId"),
        quarterId: d.get("quarterId"),
        localDate: d.get("localDate"),
        status: "completed",
        answeredCount: d.get("answeredCount"),
        questionCount: d.get("questionCount"),
        completedAt: iso(d.get("completedAt")),
      })),
      calculatedAt: this.clock().toISOString(),
    };
  }
  private async assigned(principal: Principal | undefined, activityId: string) {
    const scoped = await this.scope(principal),
      { context: c, quarter } = scoped;
    if (!quarter || !quarterAcceptsSubmissions(quarter))
      throw err(
        409,
        "BIBLE_ACTIVITY_NOT_AVAILABLE",
        "Bible activity is not currently available.",
      );
    const localDate = localDateIn(this.clock(), c.timezone),
      activity = await this.db.doc(`bibleActivities/${activityId}`).get();
    if (
      !activity.exists ||
      activity.get("organizationId") !== c.organizationId ||
      activity.get("quarterId") !== quarter.id ||
      activity.get("localDate") !== localDate ||
      activity.get("status") !== "published"
    )
      throw err(
        404,
        "BIBLE_ACTIVITY_NOT_ASSIGNED",
        "Bible activity is not assigned.",
      );
    return { ...scoped, activity, localDate };
  }
  private validate(
    activity: FirebaseFirestore.DocumentSnapshot,
    input: Input,
    complete: boolean,
  ) {
    const questions = activity.get("questions") as Array<
        Record<string, unknown>
      >,
      map = new Map(questions.map((q) => [String(q.id), q]));
    if (
      new Set(input.answers.map((a) => a.questionId)).size !==
      input.answers.length
    )
      throw err(
        422,
        "BIBLE_RESPONSE_INVALID",
        "Each question may be answered once.",
      );
    for (const answer of input.answers) {
      const q = map.get(answer.questionId),
        choices =
          q && Array.isArray(q.choices)
            ? (q.choices as Array<Record<string, unknown>>)
            : [];
      if (!q || !choices.some((c) => c.id === answer.selectedChoiceId))
        throw err(
          422,
          "BIBLE_RESPONSE_INVALID",
          "An answer references an unknown question or choice.",
        );
    }
    if (complete && input.answers.length !== questions.length)
      throw err(
        422,
        "BIBLE_RESPONSE_INVALID",
        "Every question must be answered exactly once.",
      );
    return { questions, map };
  }
  async draft(
    principal: Principal | undefined,
    activityId: string,
    input: Input,
  ) {
    const {
        context: c,
        quarter,
        activity,
        localDate,
      } = await this.assigned(principal, activityId),
      { questions } = this.validate(activity, input, false),
      ref = this.db.doc(
        `bibleResponses/${key(quarter!.id, activity.id, c.participantId)}`,
      );
    return this.db.runTransaction(async (tx) => {
      const old = await tx.get(ref);
      if (old.get("status") === "completed")
        throw err(
          409,
          "BIBLE_RESPONSE_ALREADY_COMPLETED",
          "The response is finalized.",
        );
      const version = Number(old.get("version") ?? 0);
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== version
      )
        throw err(
          409,
          "BIBLE_RESPONSE_VERSION_CONFLICT",
          "Response version changed.",
        );
      tx.set(
        ref,
        {
          organizationId: c.organizationId,
          quarterId: quarter!.id,
          participantId: c.participantId,
          activityId: activity.id,
          localDate,
          answers: input.answers,
          status: "draft",
          answeredCount: input.answers.length,
          questionCount: questions.length,
          version: version + 1,
          updatedAt: FieldValue.serverTimestamp(),
          ...(!old.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
        },
        { merge: true },
      );
      return {
        activityId,
        status: "draft",
        answeredCount: input.answers.length,
        questionCount: questions.length,
        version: version + 1,
      };
    });
  }
  async complete(
    principal: Principal | undefined,
    activityId: string,
    input: Input,
    idempotencyKey: string,
    requestId: string,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 128)
      throw err(422, "BIBLE_RESPONSE_INVALID", "Idempotency-Key is required.");
    const {
        context: c,
        quarter,
        activity,
        localDate,
      } = await this.assigned(principal, activityId),
      { questions, map } = this.validate(activity, input, true),
      ref = this.db.doc(
        `bibleResponses/${key(quarter!.id, activity.id, c.participantId)}`,
      ),
      ledger = this.db.doc(
        `pointLedger/${key("bible", quarter!.id, activity.id, c.participantId)}`,
      );
    return this.db.runTransaction(async (tx) => {
      const [old, award, rules] = await Promise.all([
        tx.get(ref),
        tx.get(ledger),
        tx.get(
          this.db
            .collection("pointRules")
            .where("organizationId", "==", c.organizationId)
            .where("sourceType", "==", "bible_activity")
            .where("status", "==", "active"),
        ),
      ]);
      if (old.get("status") === "completed") {
        if (old.get("idempotencyKey") !== idempotencyKey)
          throw err(
            409,
            "BIBLE_RESPONSE_ALREADY_COMPLETED",
            "The response is already finalized.",
          );
        return {
          activityId,
          status: "completed",
          answeredCount: old.get("answeredCount"),
          questionCount: old.get("questionCount"),
          completedAt: iso(old.get("completedAt")),
          participationPoints: Number(award.get("points")),
          idempotent: true,
        };
      }
      const eligible = rules.docs.filter(
        (r) => !r.get("quarterId") || r.get("quarterId") === quarter!.id,
      );
      if (eligible.length !== 1)
        throw err(
          503,
          "POINT_RULE_NOT_CONFIGURED",
          "Exactly one Bible participation point rule is required.",
        );
      const points = Number(eligible[0]!.get("points"));
      if (!Number.isSafeInteger(points) || points <= 0)
        throw err(
          503,
          "POINT_RULE_NOT_CONFIGURED",
          "Bible participation point rule is invalid.",
        );
      let correctCount = 0;
      for (const a of input.answers)
        if (map.get(a.questionId)?.correctChoiceId === a.selectedChoiceId)
          correctCount++;
      const version = Number(old.get("version") ?? 0) + 1;
      tx.set(
        ref,
        {
          organizationId: c.organizationId,
          quarterId: quarter!.id,
          participantId: c.participantId,
          activityId: activity.id,
          localDate,
          answers: input.answers,
          status: "completed",
          answeredCount: input.answers.length,
          correctCount,
          questionCount: questions.length,
          completedAt: FieldValue.serverTimestamp(),
          idempotencyKey,
          version,
          updatedAt: FieldValue.serverTimestamp(),
          ...(!old.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
        },
        { merge: true },
      );
      tx.create(ledger, {
        organizationId: c.organizationId,
        quarterId: quarter!.id,
        participantId: c.participantId,
        teamId: c.teamId,
        sourceType: "bible_activity",
        sourceId: ref.id,
        ruleId: eligible[0]!.id,
        ruleVersion: Number(eligible[0]!.get("version") ?? 1),
        ruleSnapshot: { sourceType: "bible_activity", points },
        points,
        actorId: c.actorUid,
        idempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        this.db.doc(
          `participantQuarterStats/${quarter!.id}_${c.participantId}`,
        ),
        {
          organizationId: c.organizationId,
          participantId: c.participantId,
          quarterId: quarter!.id,
          totalPoints: FieldValue.increment(points),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (c.teamId)
        tx.set(
          this.db.doc(`teamQuarterStats/${quarter!.id}_${c.teamId}`),
          {
            organizationId: c.organizationId,
            teamId: c.teamId,
            quarterId: quarter!.id,
            totalPoints: FieldValue.increment(points),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      for (const [event, target] of [
        ["bible.response.completed", ref.id],
        ["bible.participation.awarded", ledger.id],
      ] as const)
        tx.create(this.db.collection("auditLogs").doc(randomUUID()), {
          event,
          actorId: c.actorUid,
          organizationId: c.organizationId,
          targetId: target,
          requestId,
          metadata: {
            activityId: activity.id,
            quarterId: quarter!.id,
            points: event.endsWith("awarded") ? points : undefined,
          },
          timestamp: FieldValue.serverTimestamp(),
        });
      return {
        activityId,
        status: "completed",
        answeredCount: input.answers.length,
        questionCount: questions.length,
        participationPoints: points,
        version,
        idempotent: false,
      };
    });
  }
}
