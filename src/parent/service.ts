import type {
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { env } from "../config/env.js";
import {
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
} from "../shared/errors.js";

type Principal = { uid: string; organizationIds: readonly string[] };
type ChildStatus = "active" | "pending" | "inactive";
type ListInput = {
  limit: number;
  cursor?: string | undefined;
  status?: ChildStatus | undefined;
  search?: string | undefined;
};

const iso = (value: unknown): string | null =>
  value instanceof Timestamp
    ? value.toDate().toISOString()
    : value instanceof Date
      ? value.toISOString()
      : typeof value === "string"
        ? value
        : null;
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export class ParentService {
  constructor(private readonly db: Firestore) {}

  private async link(
    principal: Principal,
    childId: string,
    requireActive = true,
  ) {
    const snapshots = await this.db
      .collection("parentChildLinks")
      .where("parentUid", "==", principal.uid)
      .where("participantId", "==", childId)
      .limit(2)
      .get();
    const link = snapshots.docs.find(
      (doc) => !requireActive || doc.get("status") === "active",
    );
    if (!link) throw new NotFoundError();
    const organizationId = link.get("organizationId");
    if (
      typeof organizationId !== "string" ||
      !principal.organizationIds.includes(organizationId)
    )
      throw new AuthorizationError();
    const child = await this.db.doc(`participants/${childId}`).get();
    if (!child.exists) throw new NotFoundError();
    if (child.get("organizationId") !== organizationId)
      throw new AuthorizationError();
    return { link, child, organizationId };
  }

  async children(principal: Principal, input: ListInput) {
    const links = await this.db
      .collection("parentChildLinks")
      .where("parentUid", "==", principal.uid)
      .get();
    const authorized = links.docs.filter(
      (doc) =>
        principal.organizationIds.includes(doc.get("organizationId")) &&
        (!input.status || doc.get("status") === input.status),
    );
    const summaries = await Promise.all(
      authorized.map(async (link) =>
        this.summary(
          link.get("participantId"),
          link.get("organizationId"),
          link.get("status"),
        ),
      ),
    );
    const search = input.search?.toLocaleLowerCase();
    const sorted = summaries
      .filter(
        (item) =>
          !search ||
          String(item.approvedDisplayName).toLocaleLowerCase().includes(search),
      )
      .sort(
        (a, b) =>
          String(a.approvedDisplayName).localeCompare(
            String(b.approvedDisplayName),
          ) || a.id.localeCompare(b.id),
      );
    const start = input.cursor
      ? Math.max(0, sorted.findIndex((item) => item.id === input.cursor) + 1)
      : 0;
    const data = sorted.slice(start, start + input.limit);
    return {
      data,
      meta: {
        nextCursor:
          start + input.limit < sorted.length
            ? (data.at(-1)?.id ?? null)
            : null,
      },
    };
  }

  async child(principal: Principal, childId: string) {
    const { link, organizationId } = await this.link(principal, childId, false);
    return this.summary(childId, organizationId, link.get("status"));
  }

  private async summary(
    childId: string,
    organizationId: string,
    linkStatus: unknown,
  ) {
    const child = await this.db.doc(`participants/${childId}`).get();
    if (!child.exists || child.get("organizationId") !== organizationId)
      throw new NotFoundError();
    const status: ChildStatus =
      linkStatus === "pending" || linkStatus === "inactive"
        ? linkStatus
        : "active";
    const teamId =
      typeof child.get("teamId") === "string"
        ? (child.get("teamId") as string)
        : null;
    const quarter = await this.currentQuarter(organizationId);
    const team = teamId ? await this.db.doc(`teams/${teamId}`).get() : null;
    const teamStats =
      teamId && quarter
        ? await this.db.doc(`teamQuarterStats/${quarter.id}_${teamId}`).get()
        : null;
    const participation = quarter
      ? await this.db
          .collection("participationCompletions")
          .where("participantId", "==", childId)
          .where("quarterId", "==", quarter.id)
          .get()
      : null;
    const assignments = quarter
      ? await this.db
          .collection("participationActivities")
          .where("organizationId", "==", organizationId)
          .where("quarterId", "==", quarter.id)
          .where("status", "==", "active")
          .get()
      : null;
    const readingAssigned = quarter
      ? await this.db
          .collection("readingAssignments")
          .where("organizationId", "==", organizationId)
          .where("quarterId", "==", quarter.id)
          .get()
      : null;
    const readingDone = quarter
      ? await this.db
          .collection("readingResponses")
          .where("participantId", "==", childId)
          .where("quarterId", "==", quarter.id)
          .get()
      : null;
    const project = quarter
      ? await this.db
          .collection("projects")
          .where("participantId", "==", childId)
          .where("quarterId", "==", quarter.id)
          .limit(1)
          .get()
      : null;
    const target = team ? number(team.get("quarterTarget")) : 0;
    const points = teamStats?.exists ? number(teamStats.get("totalPoints")) : 0;
    return {
      id: child.id,
      approvedDisplayName:
        typeof child.get("approvedDisplayName") === "string"
          ? child.get("approvedDisplayName")
          : "",
      status,
      team: team?.exists
        ? {
            id: team.id,
            displayName:
              typeof team.get("approvedDisplayName") === "string"
                ? team.get("approvedDisplayName")
                : "",
          }
        : null,
      quarter: quarter ? { id: quarter.id, name: quarter.name } : null,
      weeklyParticipation: {
        completed: participation?.size ?? 0,
        available: assignments?.size ?? 0,
      },
      teamProgress:
        team?.exists && quarter
          ? {
              points,
              target,
              percentage:
                target > 0
                  ? Math.min(100, Math.round((points / target) * 100))
                  : 0,
            }
          : null,
      readingProgress: {
        completed: readingDone?.size ?? 0,
        assigned: readingAssigned?.size ?? 0,
      },
      projectStatus:
        project &&
        !project.empty &&
        typeof project.docs[0]!.get("status") === "string"
          ? project.docs[0]!.get("status")
          : null,
    };
  }

  private async currentQuarter(organizationId: string) {
    const now = Timestamp.now();
    const result = await this.db
      .collection("quarters")
      .where("organizationId", "==", organizationId)
      .where("status", "==", "active")
      .where("startsAt", "<=", now)
      .orderBy("startsAt", "desc")
      .limit(5)
      .get();
    const doc = result.docs.find((item) => {
      const endsAt: unknown = item.get("endsAt");
      return (
        !(endsAt instanceof Timestamp) || endsAt.toMillis() >= now.toMillis()
      );
    });
    if (!doc) return null;
    const startsAt = doc.get("startsAt") as Timestamp;
    const endsAt = doc.get("endsAt") as Timestamp;
    const totalWeeks = Math.max(
      1,
      Math.ceil((endsAt.toMillis() - startsAt.toMillis()) / 604800000),
    );
    // Intl ensures the configured IANA timezone, rather than the server timezone, defines the calendar date.
    const localToday = new Date(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: env.PROGRAM_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now.toDate()),
    );
    const localStart = new Date(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: env.PROGRAM_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(startsAt.toDate()),
    );
    return {
      id: doc.id,
      name: typeof doc.get("name") === "string" ? doc.get("name") : "",
      status: "active",
      weekNumber: Math.min(
        totalWeeks,
        Math.max(
          1,
          Math.floor(
            (localToday.getTime() - localStart.getTime()) / 604800000,
          ) + 1,
        ),
      ),
      totalWeeks,
    };
  }

  async dashboard(principal: Principal) {
    const children = await this.children(principal, { limit: 50 });
    const user = await this.db.doc(`users/${principal.uid}`).get();
    const organizationId = principal.organizationIds[0];
    const currentQuarter = organizationId
      ? await this.currentQuarter(organizationId)
      : null;
    const activities = await this.db
      .collection("familyActivityCompletions")
      .where("parentUid", "==", principal.uid)
      .get();
    const notifications = await this.db
      .collection("notifications")
      .where("recipientUid", "==", principal.uid)
      .where("read", "==", false)
      .get();
    return {
      parent: {
        uid: principal.uid,
        displayName:
          typeof user.get("displayName") === "string"
            ? user.get("displayName")
            : "",
      },
      children: children.data,
      summary: {
        activeChildren: children.data.filter((x) => x.status === "active")
          .length,
        weeklyParticipationCompleted: children.data.reduce(
          (n, x) => n + x.weeklyParticipation.completed,
          0,
        ),
        weeklyParticipationAvailable: children.data.reduce(
          (n, x) => n + x.weeklyParticipation.available,
          0,
        ),
        familyActivitiesCompleted: activities.docs.filter((x) =>
          principal.organizationIds.includes(x.get("organizationId")),
        ).length,
        unreadNotifications: notifications.docs.filter((x) =>
          principal.organizationIds.includes(x.get("organizationId")),
        ).length,
      },
      currentQuarter,
      updatedAt: new Date().toISOString(),
    };
  }

  async observations(principal: Principal, input: ListInput) {
    let query = this.db
      .collection("characterObservations")
      .where("parentUid", "==", principal.uid)
      .orderBy("createdAt", "desc")
      .limit(input.limit + 1);
    if (input.cursor) {
      const cursor = await this.db
        .doc(`characterObservations/${input.cursor}`)
        .get();
      if (!cursor.exists || cursor.get("parentUid") !== principal.uid)
        throw new NotFoundError();
      query = query.startAfter(cursor);
    }
    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, input.limit);
    return {
      data: docs.map((doc) => this.observationView(doc)),
      meta: {
        nextCursor:
          snapshot.size > input.limit ? (docs.at(-1)?.id ?? null) : null,
      },
    };
  }
  async observation(principal: Principal, id: string) {
    const doc = await this.db.doc(`characterObservations/${id}`).get();
    if (
      !doc.exists ||
      doc.get("parentUid") !== principal.uid ||
      !principal.organizationIds.includes(doc.get("organizationId"))
    )
      throw new NotFoundError();
    return this.observationView(doc);
  }
  private observationView(doc: QueryDocumentSnapshot | DocumentSnapshot) {
    return {
      id: doc.id,
      childId: doc.get("participantId"),
      qualityId: doc.get("qualityId") ?? null,
      description: doc.get("description"),
      observedAt: iso(doc.get("observedAt")),
      moderationStatus: doc.get("moderationStatus"),
      createdAt: iso(doc.get("createdAt")),
    };
  }
  async createObservation(
    principal: Principal,
    input: {
      childId: string;
      qualityId?: string | undefined;
      description: string;
      observedAt: string;
    },
  ) {
    const linked = await this.link(principal, input.childId);
    const ref = this.db.collection("characterObservations").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        parentUid: principal.uid,
        participantId: input.childId,
        organizationId: linked.organizationId,
        qualityId: input.qualityId ?? null,
        description: input.description,
        observedAt: Timestamp.fromDate(new Date(input.observedAt)),
        moderationStatus: "pending",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.create(this.db.collection("auditLogs").doc(), {
        event: "parent.observation.created",
        actorUid: principal.uid,
        resourceId: ref.id,
        organizationId: linked.organizationId,
        createdAt: FieldValue.serverTimestamp(),
      });
      return Promise.resolve();
    });
    return { id: ref.id, moderationStatus: "pending" };
  }

  async qualities(principal: Principal) {
    const snap = await this.db
      .collection("characterQualities")
      .where("status", "==", "active")
      .get();
    return {
      data: snap.docs
        .filter(
          (x) =>
            !x.get("organizationId") ||
            principal.organizationIds.includes(x.get("organizationId")),
        )
        .map((x) => ({
          id: x.id,
          name: x.get("name"),
          description: x.get("description") ?? null,
        })),
      meta: { nextCursor: null },
    };
  }
  async selection(principal: Principal, childId: string, quarterId: string) {
    await this.link(principal, childId);
    const doc = await this.db
      .doc(`characterSelections/${quarterId}_${childId}`)
      .get();
    return doc.exists
      ? {
          childId,
          quarterId,
          qualityIds: doc.get("qualityIds") ?? [],
          updatedAt: iso(doc.get("updatedAt")),
        }
      : { childId, quarterId, qualityIds: [], updatedAt: null };
  }
  async setSelection(
    principal: Principal,
    input: { childId: string; quarterId: string; qualityIds: string[] },
  ) {
    const linked = await this.link(principal, input.childId);
    const quarter = await this.db.doc(`quarters/${input.quarterId}`).get();
    if (
      !quarter.exists ||
      quarter.get("organizationId") !== linked.organizationId ||
      quarter.get("status") !== "active"
    )
      throw new BusinessRuleError(
        "QUARTER_NOT_OPEN",
        "Character selections are not open for this quarter.",
      );
    const qualities = await Promise.all(
      input.qualityIds.map((id) =>
        this.db.doc(`characterQualities/${id}`).get(),
      ),
    );
    if (
      qualities.some(
        (x) =>
          !x.exists ||
          x.get("status") !== "active" ||
          (x.get("organizationId") &&
            x.get("organizationId") !== linked.organizationId),
      )
    )
      throw new BusinessRuleError(
        "INVALID_CHARACTER_QUALITY",
        "A selected quality is unavailable.",
      );
    await this.db.runTransaction((tx) => {
      tx.set(
        this.db.doc(`characterSelections/${input.quarterId}_${input.childId}`),
        {
          participantId: input.childId,
          quarterId: input.quarterId,
          organizationId: linked.organizationId,
          qualityIds: input.qualityIds,
          selectedBy: principal.uid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return Promise.resolve();
    });
    return this.selection(principal, input.childId, input.quarterId);
  }

  async familyActivities(principal: Principal, childId: string) {
    const linked = await this.link(principal, childId);
    const quarter = await this.currentQuarter(linked.organizationId);
    if (!quarter) return { data: [], meta: { nextCursor: null } };
    const [available, completed] = await Promise.all([
      this.db
        .collection("familyActivities")
        .where("organizationId", "==", linked.organizationId)
        .where("quarterId", "==", quarter.id)
        .where("status", "==", "active")
        .get(),
      this.db
        .collection("familyActivityCompletions")
        .where("participantId", "==", childId)
        .where("quarterId", "==", quarter.id)
        .get(),
    ]);
    const ids = new Set(completed.docs.map((x) => String(x.get("activityId"))));
    return {
      data: available.docs.map((x) => ({
        id: x.id,
        title: x.get("title"),
        description: x.get("description") ?? null,
        week: x.get("week"),
        completed: ids.has(x.id),
      })),
      meta: { nextCursor: null },
    };
  }
  async completeFamilyActivity(
    principal: Principal,
    childId: string,
    activityId: string,
  ) {
    const linked = await this.link(principal, childId);
    const activity = await this.db.doc(`familyActivities/${activityId}`).get();
    if (
      !activity.exists ||
      activity.get("organizationId") !== linked.organizationId ||
      activity.get("status") !== "active"
    )
      throw new NotFoundError();
    const id = `${activityId}_${childId}`;
    const ref = this.db.doc(`familyActivityCompletions/${id}`);
    return this.db.runTransaction(async (tx) => {
      const old = await tx.get(ref);
      if (old.exists) return { id, created: false };
      tx.create(ref, {
        activityId,
        participantId: childId,
        parentUid: principal.uid,
        organizationId: linked.organizationId,
        quarterId: activity.get("quarterId"),
        week: activity.get("week"),
        completedAt: FieldValue.serverTimestamp(),
      });
      return { id, created: true };
    });
  }

  async supportCategories(principal: Principal) {
    const snap = await this.db
      .collection("supportCategories")
      .where("status", "==", "active")
      .get();
    return {
      data: snap.docs
        .filter((x) =>
          principal.organizationIds.includes(x.get("organizationId")),
        )
        .map((x) => ({
          id: x.id,
          name: x.get("name"),
          description: x.get("description") ?? null,
        })),
      meta: { nextCursor: null },
    };
  }
  async createSupport(
    principal: Principal,
    input: {
      childId: string;
      categoryId: string;
      subject: string;
      description: string;
    },
  ) {
    const linked = await this.link(principal, input.childId);
    const category = await this.db
      .doc(`supportCategories/${input.categoryId}`)
      .get();
    if (
      !category.exists ||
      category.get("organizationId") !== linked.organizationId ||
      category.get("status") !== "active"
    )
      throw new NotFoundError();
    const ref = this.db.collection("supportRequests").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        participantId: input.childId,
        requesterUid: principal.uid,
        organizationId: linked.organizationId,
        categoryId: input.categoryId,
        subject: input.subject,
        description: input.description,
        status: "open",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        version: 1,
      });
      return Promise.resolve();
    });
    return { id: ref.id, status: "open" };
  }
  async supportList(principal: Principal, input: ListInput) {
    let q = this.db
      .collection("supportRequests")
      .where("requesterUid", "==", principal.uid)
      .orderBy("createdAt", "desc")
      .limit(input.limit + 1);
    if (input.cursor) {
      const c = await this.db.doc(`supportRequests/${input.cursor}`).get();
      if (!c.exists || c.get("requesterUid") !== principal.uid)
        throw new NotFoundError();
      q = q.startAfter(c);
    }
    const snap = await q.get();
    const docs = snap.docs.slice(0, input.limit);
    return {
      data: docs.map((x) => ({
        id: x.id,
        childId: x.get("participantId"),
        categoryId: x.get("categoryId"),
        subject: x.get("subject"),
        status: x.get("status"),
        createdAt: iso(x.get("createdAt")),
        updatedAt: iso(x.get("updatedAt")),
      })),
      meta: {
        nextCursor: snap.size > input.limit ? (docs.at(-1)?.id ?? null) : null,
      },
    };
  }
  async supportDetail(principal: Principal, id: string) {
    const doc = await this.db.doc(`supportRequests/${id}`).get();
    if (
      !doc.exists ||
      doc.get("requesterUid") !== principal.uid ||
      !principal.organizationIds.includes(doc.get("organizationId"))
    )
      throw new NotFoundError();
    return {
      id,
      childId: doc.get("participantId"),
      categoryId: doc.get("categoryId"),
      subject: doc.get("subject"),
      description: doc.get("description"),
      status: doc.get("status"),
      createdAt: iso(doc.get("createdAt")),
      updatedAt: iso(doc.get("updatedAt")),
    };
  }

  async report(principal: Principal, childId: string) {
    const child = await this.child(principal, childId);
    return {
      childId,
      quarter: child.quarter,
      participation: {
        completed: child.weeklyParticipation.completed,
        available: child.weeklyParticipation.available,
        notAvailable: child.weeklyParticipation.available === 0,
      },
      reading: {
        ...child.readingProgress,
        notAvailable: child.readingProgress.assigned === 0,
      },
      projects: child.projectStatus
        ? { status: child.projectStatus, notAvailable: false }
        : { status: null, notAvailable: true },
      teamProgress: child.teamProgress
        ? { ...child.teamProgress, notAvailable: false }
        : { notAvailable: true },
      quarterComparison: { notAvailable: true },
    };
  }
  async teamProgress(principal: Principal, teamId: string, quarterId: string) {
    const children = await this.children(principal, { limit: 50 });
    if (!children.data.some((x) => x.team?.id === teamId))
      throw new NotFoundError();
    const [team, quarter, ledger] = await Promise.all([
      this.db.doc(`teams/${teamId}`).get(),
      this.db.doc(`quarters/${quarterId}`).get(),
      this.db
        .collection("pointLedger")
        .where("teamId", "==", teamId)
        .where("quarterId", "==", quarterId)
        .get(),
    ]);
    if (
      !team.exists ||
      !quarter.exists ||
      !principal.organizationIds.includes(team.get("organizationId")) ||
      quarter.get("organizationId") !== team.get("organizationId")
    )
      throw new NotFoundError();
    const totalPoints = ledger.docs.reduce(
      (sum, x) => sum + number(x.get("points")),
      0,
    );
    const target = number(team.get("quarterTarget"));
    return {
      teamId,
      approvedDisplayName: team.get("approvedDisplayName") ?? "",
      quarterId,
      totalPoints,
      target,
      percentage:
        target > 0
          ? Math.min(100, Math.round((totalPoints / target) * 100))
          : 0,
      calculatedAt: new Date().toISOString(),
    };
  }
}
