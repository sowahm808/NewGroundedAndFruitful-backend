import type {
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from "../shared/errors.js";

type Principal = {
  uid: string;
  organizationIds: readonly string[];
  activeWorkspaceId?: string;
};
type ChildStatus = "active" | "pending" | "inactive";
type ListInput = {
  limit: number;
  cursor?: string | undefined;
  status?:
    | ChildStatus
    | "open"
    | "in_progress"
    | "resolved"
    | "closed"
    | "approved"
    | "rejected"
    | undefined;
  search?: string | undefined;
  childId?: string | undefined;
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
const commandId = (actor: string, key: string) =>
  createHash("sha256").update(`${actor}:${key}`).digest("hex");
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class ParentService {
  constructor(private readonly db: Firestore) {}

  // private tenantIds(principal: Principal): readonly string[] {
  //   return principal.activeWorkspaceId
  //     ? [principal.activeWorkspaceId]
  //     : principal.organizationIds;
  // }
private tenantIds(principal: Principal): readonly string[] {
    const list = new Set<string>();
    if (principal.activeWorkspaceId) list.add(principal.activeWorkspaceId);
    if (Array.isArray(principal.organizationIds)) {
      principal.organizationIds.forEach((id) => list.add(id));
    }
    return Array.from(list);
  }
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
      !this.tenantIds(principal).includes(organizationId)
    )
      throw new AuthorizationError();
    const child = await this.db.doc(`participants/${childId}`).get();
    if (!child.exists) throw new NotFoundError();
    if (child.get("organizationId") !== organizationId)
      throw new AuthorizationError();
    return { link, child, organizationId };
  }

  // async children(principal: Principal, input: ListInput) {
  //   const links = await this.db
  //     .collection("parentChildLinks")
  //     .where("parentUid", "==", principal.uid)
  //     .limit(200)
  //     .get();
  //   const authorized = links.docs.filter(
  //     (doc) =>
  //       doc.get("status") === "active" &&
  //       this.tenantIds(principal).includes(doc.get("organizationId")) &&
  //       typeof doc.get("participantId") === "string" &&
  //       typeof doc.get("organizationId") === "string",
  //   );
  //   const summaries = await Promise.all(
  //     authorized.map(async (link) => {
  //       const participantId = link.get("participantId");
  //       const organizationId = link.get("organizationId");
  //       if (
  //         typeof participantId !== "string" ||
  //         typeof organizationId !== "string"
  //       )
  //         throw new NotFoundError();
  //       const participant = await this.db
  //         .doc(`participants/${participantId}`)
  //         .get();
  //       if (
  //         !participant.exists ||
  //         participant.get("organizationId") !== organizationId ||
  //         participant.get("status") !== "active"
  //       )
  //         return null;
  //       return this.summary(participantId, organizationId, link.get("status"));
  //     }),
  //   );
  //   const search = input.search?.toLocaleLowerCase();
  //   const sorted = summaries
  //     .filter((item): item is NonNullable<typeof item> => item !== null)
  //     .filter(
  //       (item) =>
  //         (!input.status || item.status === input.status) &&
  //         (!search ||
  //           String(item.approvedDisplayName)
  //             .toLocaleLowerCase()
  //             .includes(search)),
  //     )
  //     .sort(
  //       (a, b) =>
  //         String(a.approvedDisplayName).localeCompare(
  //           String(b.approvedDisplayName),
  //         ) || a.id.localeCompare(b.id),
  //     );
  //   const cursorIndex = input.cursor
  //     ? sorted.findIndex((item) => item.id === input.cursor)
  //     : -1;
  //   if (input.cursor && cursorIndex < 0) throw new NotFoundError();
  //   const start = cursorIndex + 1;
  //   const data = sorted.slice(start, start + input.limit);
  //   return {
  //     data,
  //     meta: {
  //       nextCursor:
  //         start + input.limit < sorted.length
  //           ? (data.at(-1)?.id ?? null)
  //           : null,
  //     },
  //   };
  // }
async children(principal: Principal, input: ListInput) {
    // 1. Fetch links by parent UID
    const [linksSnap, relSnap, directSnap] = await Promise.all([
      this.db
        .collection("parentChildLinks")
        .where("parentUid", "==", principal.uid)
        .where("status", "==", "active")
        .limit(200)
        .get(),
      this.db
        .collection("relationships")
        .where("userId", "==", principal.uid)
        .where("status", "==", "active")
        .limit(200)
        .get(),
      this.db
        .collection("participants")
        .where("guardianUserId", "==", principal.uid)
        .where("status", "==", "active")
        .limit(200)
        .get(),
    ]);

    // Extract all unique participant IDs and their respective organization IDs
    const targets = new Map<string, string>();

    linksSnap.docs.forEach((doc) => {
      const pId = doc.get("participantId");
      const orgId = doc.get("organizationId");
      if (pId && orgId) targets.set(pId, orgId);
    });

    relSnap.docs.forEach((doc) => {
      const pId = doc.get("participantId");
      const orgId = doc.get("organizationId");
      if (pId && orgId && !targets.has(pId)) targets.set(pId, orgId);
    });

    directSnap.docs.forEach((doc) => {
      const orgId = doc.get("organizationId");
      if (orgId && !targets.has(doc.id)) targets.set(doc.id, orgId);
    });

    const summaries = await Promise.all(
      Array.from(targets.entries()).map(async ([participantId, organizationId]) => {
        const participant = await this.db.doc(`participants/${participantId}`).get();
        if (!participant.exists || participant.get("status") !== "active") {
          return null;
        }
        return this.summary(participantId, organizationId, "active");
      }),
    );

    const search = input.search?.toLocaleLowerCase();
    const sorted = summaries
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .filter(
        (item) =>
          (!input.status || item.status === input.status) &&
          (!search ||
            String(item.approvedDisplayName)
              .toLocaleLowerCase()
              .includes(search)),
      )
      .sort(
        (a, b) =>
          String(a.approvedDisplayName).localeCompare(
            String(b.approvedDisplayName),
          ) || a.id.localeCompare(b.id),
      );

    const cursorIndex = input.cursor
      ? sorted.findIndex((item) => item.id === input.cursor)
      : -1;
    if (input.cursor && cursorIndex < 0) throw new NotFoundError();
    const start = cursorIndex + 1;
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
    const { organizationId } = await this.link(principal, childId);
    return this.summary(childId, organizationId, "active");
  }

  private async summary(
    childId: string,
    organizationId: string,
    linkStatus: unknown,
  ) {
    const child = await this.db.doc(`participants/${childId}`).get();
    if (!child.exists || child.get("organizationId") !== organizationId)
      throw new NotFoundError();
    const participantStatus = child.get("status");
    const status: ChildStatus =
      participantStatus === "pending" || participantStatus === "inactive"
        ? participantStatus
        : linkStatus === "active"
          ? "active"
          : "inactive";
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
    const configuredTarget = team?.get("quarterTarget");
    const recordedPoints = teamStats?.get("totalPoints");
    const hasTeamProgress =
      teamStats?.exists === true &&
      typeof recordedPoints === "number" &&
      Number.isFinite(recordedPoints) &&
      typeof configuredTarget === "number" &&
      Number.isFinite(configuredTarget) &&
      configuredTarget > 0;
    const calculatedAt = new Date().toISOString();
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
        team?.exists && quarter && hasTeamProgress
          ? {
              points: recordedPoints,
              target: configuredTarget,
              percentage: Math.min(
                100,
                Math.round((recordedPoints / configuredTarget) * 100),
              ),
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
      calculatedAt,
      sourceQuarterId: quarter?.id ?? null,
      sourceWeekId: quarter
        ? `${quarter.id}:week:${String(quarter.weekNumber)}`
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
    const tenantIds = this.tenantIds(principal);
    const organizationId = tenantIds[0];
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
    const organizations = await Promise.all(
      tenantIds.map(async (id) => {
        const organization = await this.db.doc(`organizations/${id}`).get();
        return {
          id,
          name:
            organization.exists && typeof organization.get("name") === "string"
              ? organization.get("name")
              : null,
        };
      }),
    );
    const calculatedAt = new Date().toISOString();
    return {
      organizations,
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
          this.tenantIds(principal).includes(x.get("organizationId")),
        ).length,
        unreadNotifications: notifications.docs.filter((x) =>
          this.tenantIds(principal).includes(x.get("organizationId")),
        ).length,
      },
      currentQuarter,
      calculatedAt,
      sourceQuarterId: currentQuarter?.id ?? null,
      sourceWeekId: currentQuarter
        ? `${currentQuarter.id}:week:${String(currentQuarter.weekNumber)}`
        : null,
    };
  }

  async notifications(principal: Principal, input: ListInput) {
    const snapshot = await this.db
      .collection("notifications")
      .where("recipientUid", "==", principal.uid)
      .limit(200)
      .get();
    const sorted = snapshot.docs
      .filter((doc) =>
        this.tenantIds(principal).includes(doc.get("organizationId")),
      )
      .map((doc) => ({
        id: doc.id,
        organizationId: String(doc.get("organizationId")),
        type: typeof doc.get("type") === "string" ? doc.get("type") : null,
        title: typeof doc.get("title") === "string" ? doc.get("title") : null,
        message:
          typeof doc.get("message") === "string" ? doc.get("message") : null,
        read: doc.get("read") === true,
        createdAt: iso(doc.get("createdAt")),
      }))
      .sort(
        (a, b) =>
          (b.createdAt ?? "").localeCompare(a.createdAt ?? "") ||
          a.id.localeCompare(b.id),
      );
    const start = input.cursor
      ? Math.max(0, sorted.findIndex((item) => item.id === input.cursor) + 1)
      : 0;
    const data = sorted.slice(start, start + input.limit);
    return {
      data,
      meta: {
        nextCursor:
          start + input.limit < sorted.length && data.length > 0
            ? data.at(-1)!.id
            : null,
      },
    };
  }

  async observations(principal: Principal, input: ListInput) {
    if (input.childId) await this.link(principal, input.childId);
    const [snapshot, linkSnapshot] = await Promise.all([
      this.db
        .collection("characterObservations")
        .where("parentUid", "==", principal.uid)
        .limit(200)
        .get(),
      this.db
        .collection("parentChildLinks")
        .where("parentUid", "==", principal.uid)
        .limit(200)
        .get(),
    ]);
    const activeLinks = new Set(
      linkSnapshot.docs
        .filter(
          (link) =>
            link.get("status") === "active" &&
            this.tenantIds(principal).includes(link.get("organizationId")),
        )
        .map(
          (link) =>
            `${String(link.get("organizationId"))}:${String(link.get("participantId"))}`,
        ),
    );
    const authorized = snapshot.docs
      .filter(
        (doc) =>
          activeLinks.has(
            `${String(doc.get("organizationId"))}:${String(doc.get("participantId"))}`,
          ) &&
          (!input.childId || doc.get("participantId") === input.childId) &&
          (!input.status || doc.get("moderationStatus") === input.status) &&
          (!input.search ||
            String(doc.get("description"))
              .toLocaleLowerCase()
              .includes(input.search.toLocaleLowerCase())),
      )
      .sort((a, b) => {
        const createdAtDifference = (
          iso(b.get("createdAt")) ?? ""
        ).localeCompare(iso(a.get("createdAt")) ?? "");
        return createdAtDifference || b.id.localeCompare(a.id);
      });
    const cursorIndex = input.cursor
      ? authorized.findIndex((doc) => doc.id === input.cursor)
      : -1;
    if (input.cursor && cursorIndex === -1) throw new NotFoundError();
    const start = cursorIndex + 1;
    const docs = authorized.slice(start, start + input.limit);
    return {
      data: docs.map((doc) => this.observationView(doc)),
      meta: {
        nextCursor:
          start + input.limit < authorized.length
            ? (docs.at(-1)?.id ?? null)
            : null,
      },
    };
  }
  async observation(principal: Principal, id: string) {
    const doc = await this.db.doc(`characterObservations/${id}`).get();
    if (
      !doc.exists ||
      doc.get("parentUid") !== principal.uid ||
      !this.tenantIds(principal).includes(doc.get("organizationId"))
    )
      throw new NotFoundError();
    await this.link(principal, String(doc.get("participantId")));
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
    idempotencyKey?: string,
  ) {
    const linked = await this.link(principal, input.childId);
    const ref = idempotencyKey
      ? this.db.doc(
          `characterObservations/${commandId(principal.uid, idempotencyKey)}`,
        )
      : this.db.collection("characterObservations").doc();
    const operationFingerprint = fingerprint(input);
    const created = await this.db.runTransaction(async (tx) => {
      const old = await tx.get(ref);
      if (old.exists) {
        if (
          old.get("parentUid") !== principal.uid ||
          old.get("operationFingerprint") !== operationFingerprint
        )
          throw new ConflictError(
            "Idempotency key was already used for another observation.",
          );
        return false;
      }
      tx.create(ref, {
        parentUid: principal.uid,
        participantId: input.childId,
        organizationId: linked.organizationId,
        qualityId: input.qualityId ?? null,
        description: input.description,
        observedAt: Timestamp.fromDate(new Date(input.observedAt)),
        moderationStatus: "pending",
        operationFingerprint,
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
      return true;
    });
    return { id: ref.id, moderationStatus: "pending", created };
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
            this.tenantIds(principal).includes(x.get("organizationId")),
        )
        .map((x) => ({
          id: x.id,
          name: x.get("name"),
          description: x.get("description") ?? null,
        }))
        .sort(
          (a, b) =>
            String(a.name).localeCompare(String(b.name)) ||
            a.id.localeCompare(b.id),
        ),
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
          version: number(doc.get("version")),
          updatedAt: iso(doc.get("updatedAt")),
        }
      : { childId, quarterId, qualityIds: [], version: 0, updatedAt: null };
  }
  async setSelection(
    principal: Principal,
    input: {
      childId: string;
      quarterId: string;
      qualityIds: string[];
      expectedVersion?: number;
    },
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
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.doc(
        `characterSelections/${input.quarterId}_${input.childId}`,
      );
      const old = await tx.get(ref);
      const currentVersion = old.exists ? number(old.get("version")) : 0;
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== currentVersion
      )
        throw new ConflictError("Character selection version is stale.");
      tx.set(
        ref,
        {
          participantId: input.childId,
          quarterId: input.quarterId,
          organizationId: linked.organizationId,
          qualityIds: input.qualityIds,
          selectedBy: principal.uid,
          version: currentVersion + 1,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
    return this.selection(principal, input.childId, input.quarterId);
  }

  async familyActivities(
    principal: Principal,
    childId: string,
    input: {
      limit?: number | undefined;
      cursor?: string | undefined;
      search?: string | undefined;
    } = {},
  ) {
    const linked = await this.link(principal, childId);
    const quarter = await this.currentQuarter(linked.organizationId);
    if (!quarter)
      return {
        data: [],
        meta: { nextCursor: null },
        calculatedAt: new Date().toISOString(),
        sourceQuarterId: null,
        sourceWeekId: null,
      };
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
    const search = input.search?.toLocaleLowerCase();
    const sorted = available.docs
      .filter(
        (x) =>
          !search ||
          String(x.get("title")).toLocaleLowerCase().includes(search),
      )
      .sort(
        (a, b) =>
          number(a.get("week")) - number(b.get("week")) ||
          a.id.localeCompare(b.id),
      );
    const cursorIndex = input.cursor
      ? sorted.findIndex((x) => x.id === input.cursor)
      : -1;
    if (input.cursor && cursorIndex < 0) throw new NotFoundError();
    const start = cursorIndex + 1,
      limit = input.limit ?? 20,
      page = sorted.slice(start, start + limit);
    return {
      data: page.map((x) => ({
        id: x.id,
        title: x.get("title"),
        description: x.get("description") ?? null,
        week: x.get("week"),
        completed: ids.has(x.id),
      })),
      meta: {
        nextCursor:
          start + limit < sorted.length ? (page.at(-1)?.id ?? null) : null,
      },
      calculatedAt: new Date().toISOString(),
      sourceQuarterId: quarter.id,
      sourceWeekId: `${quarter.id}:week:${String(quarter.weekNumber)}`,
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
          this.tenantIds(principal).includes(x.get("organizationId")),
        )
        .map((x) => ({
          id: x.id,
          name: x.get("name"),
          description: x.get("description") ?? null,
        }))
        .sort(
          (a, b) =>
            String(a.name).localeCompare(String(b.name)) ||
            a.id.localeCompare(b.id),
        ),
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
    idempotencyKey?: string,
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
    const ref = idempotencyKey
      ? this.db.doc(
          `supportRequests/${commandId(principal.uid, idempotencyKey)}`,
        )
      : this.db.collection("supportRequests").doc();
    const operationFingerprint = fingerprint(input);
    const created = await this.db.runTransaction(async (tx) => {
      const old = await tx.get(ref);
      if (old.exists) {
        if (
          old.get("requesterUid") !== principal.uid ||
          old.get("operationFingerprint") !== operationFingerprint
        )
          throw new ConflictError(
            "Idempotency key was already used for another support request.",
          );
        return false;
      }
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
        operationFingerprint,
      });
      return true;
    });
    return { id: ref.id, status: "open", created };
  }
  async supportList(principal: Principal, input: ListInput) {
    // Keep this query index-independent, then enforce relationship, tenant and
    // allowlisted filters before pagination. An absent collection is a normal
    // empty QuerySnapshot in Firestore and therefore returns an empty list.
    const [snap, linkSnapshot] = await Promise.all([
      this.db
        .collection("supportRequests")
        .where("requesterUid", "==", principal.uid)
        .get(),
      this.db
        .collection("parentChildLinks")
        .where("parentUid", "==", principal.uid)
        .get(),
    ]);
    const activeLinks = new Set(
      linkSnapshot.docs
        .filter(
          (link) =>
            link.get("status") === "active" &&
            this.tenantIds(principal).includes(link.get("organizationId")),
        )
        .map(
          (link) =>
            `${String(link.get("organizationId"))}:${String(link.get("participantId"))}`,
        ),
    );
    const authorized = snap.docs
      .filter(
        (doc) =>
          activeLinks.has(
            `${String(doc.get("organizationId"))}:${String(doc.get("participantId"))}`,
          ) &&
          (!input.childId || doc.get("participantId") === input.childId) &&
          (!input.status || doc.get("status") === input.status) &&
          (!input.search ||
            String(doc.get("subject"))
              .toLocaleLowerCase()
              .includes(input.search.toLocaleLowerCase())),
      )
      .sort(
        (a, b) =>
          (iso(b.get("createdAt")) ?? "").localeCompare(
            iso(a.get("createdAt")) ?? "",
          ) || b.id.localeCompare(a.id),
      );
    const cursorIndex = input.cursor
      ? authorized.findIndex((doc) => doc.id === input.cursor)
      : -1;
    if (input.cursor && cursorIndex < 0) throw new NotFoundError();
    const start = cursorIndex + 1;
    const docs = authorized.slice(start, start + input.limit);
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
        nextCursor:
          start + input.limit < authorized.length
            ? (docs.at(-1)?.id ?? null)
            : null,
      },
    };
  }
  async supportDetail(principal: Principal, id: string) {
    const doc = await this.db.doc(`supportRequests/${id}`).get();
    if (
      !doc.exists ||
      doc.get("requesterUid") !== principal.uid ||
      !this.tenantIds(principal).includes(doc.get("organizationId"))
    )
      throw new NotFoundError();
    await this.link(principal, String(doc.get("participantId")));
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
// in src/parent/service.ts -> listChildren
async listChildren(principal: Principal | undefined, query: { status?: string }) {
  if (!principal?.uid) return [];

  const parentUid = principal.uid;

  // 1. Check parentChildLinks
  const linkDocs = (
    await this.db
      .collection("parentChildLinks")
      .where("parentUid", "==", parentUid)
      .get()
  ).docs;

  // 2. Check relationships collection
  const relDocs = (
    await this.db
      .collection("relationships")
      .where("userId", "==", parentUid)
      .get()
  ).docs;

  // 3. Check direct participants guardian field
  const directDocs = (
    await this.db
      .collection("participants")
      .where("guardianUserId", "==", parentUid)
      .get()
  ).docs;

  const participantIds = Array.from(
    new Set([
      ...linkDocs.map((d) => d.data().participantId),
      ...relDocs.map((d) => d.data().participantId),
      ...directDocs.map((d) => d.id),
    ]),
  ).filter(Boolean);

  if (participantIds.length === 0) {
    return [];
  }

  // Fetch full participant details
  const participantSnapshots = await Promise.all(
    participantIds.map((id) => this.db.collection("participants").doc(id).get()),
  );

  return participantSnapshots
    .filter((doc) => doc.exists)
    .map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        displayName: data.displayName || data.name || "Child",
        status: data.status || "active",
        birthDate: data.birthDate || null,
        activeTeamId: data.activeTeamId || null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      };
    });
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
      calculatedAt: new Date().toISOString(),
      sourceQuarterId: child.quarter?.id ?? null,
      sourceWeekId: child.sourceWeekId,
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
      !this.tenantIds(principal).includes(team.get("organizationId")) ||
      quarter.get("organizationId") !== team.get("organizationId")
    )
      throw new NotFoundError();
    const totalPoints = ledger.docs.reduce(
      (sum, x) => sum + number(x.get("points")),
      0,
    );
    const configuredTarget = team.get("quarterTarget");
    const hasTarget =
      typeof configuredTarget === "number" &&
      Number.isFinite(configuredTarget) &&
      configuredTarget > 0;
    return {
      teamId,
      approvedDisplayName: team.get("approvedDisplayName") ?? "",
      quarterId,
      totalPoints,
      target: hasTarget ? configuredTarget : null,
      percentage: hasTarget
        ? Math.min(100, Math.round((totalPoints / configuredTarget) * 100))
        : null,
      notAvailable: !hasTarget,
      calculatedAt: new Date().toISOString(),
      sourceQuarterId: quarterId,
      sourceWeekId: null,
    };
  }
}
