import type { Auth } from "firebase-admin/auth";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import {
  requireAuthenticated,
  requireCapability,
  requireOrganizationRole,
  requirePlatformSuperAdmin,
  type Principal,
} from "../auth/authorization.js";
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from "../shared/errors.js";
import type { Role } from "../auth/roles.js";

type Data = Record<string, unknown>;
const textValue = (value: unknown): string =>
  typeof value === "string" ? value : "";
export class AdministrationService {
  constructor(
    private db: Firestore,
    private auth: Auth,
  ) {}
  private actor(p: Principal | undefined) {
    return requireAuthenticated(p);
  }
  private admin(p: Principal | undefined, organizationId: string) {
    return requireOrganizationRole(p, organizationId, ["admin", "super_admin"]);
  }
  private superAdmin(p: Principal | undefined, organizationId: string) {
    return requireOrganizationRole(p, organizationId, ["super_admin"]);
  }
  private participantActor(
    p: Principal | undefined,
    capability: "admin.participants.read" | "admin.participants.manage",
    requestedOrganizationId?: string,
  ) {
    const actor = requireCapability(p, capability);
    const organizationId = actor.activeOrganizationId;
    if (
      actor.onboardingStatus !== "complete" ||
      !organizationId ||
      (requestedOrganizationId !== undefined &&
        requestedOrganizationId !== organizationId) ||
      !actor.memberships?.some(
        (membership) =>
          membership.userId === actor.uid &&
          membership.organizationId === organizationId,
      )
    )
      throw new AuthorizationError();
    return { actor, organizationId };
  }
  async resources(
    p: Principal | undefined,
    collection: string,
    organizationId: string,
    superOnly = false,
  ) {
    if (superOnly) this.superAdmin(p, organizationId);
    else this.admin(p, organizationId);
    const snap = await this.db
      .collection(collection)
      .where("organizationId", "==", organizationId)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async listResources(
    p: Principal | undefined,
    collection: string,
    query: {
      organizationId?: string | undefined;
      page: number;
      pageSize: number;
      sort: "updatedAt" | "-updatedAt";
    },
  ) {
    const { organizationId, page, pageSize, sort } = query;
    let resourceQuery = this.db.collection(collection);
    if (organizationId) {
      this.admin(p, organizationId);
      resourceQuery = resourceQuery.where(
        "organizationId",
        "==",
        organizationId,
      ) as typeof resourceQuery;
    } else {
      requirePlatformSuperAdmin(p);
    }
    const timestamp = (value: unknown) =>
      typeof value === "object" &&
      value !== null &&
      "toMillis" in value &&
      typeof value.toMillis === "function"
        ? (value as { toMillis(): number }).toMillis()
        : 0;
    const results: Array<Data & { id: string }> = (
      await resourceQuery.get()
    ).docs
      .map<Data & { id: string }>((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => {
        const difference = timestamp(a.updatedAt) - timestamp(b.updatedAt);
        return (
          (sort === "-updatedAt" ? -difference : difference) ||
          a.id.localeCompare(b.id)
        );
      });
    const total = results.length;
    return {
      items: results.slice((page - 1) * pageSize, page * pageSize),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
  async resource(
    p: Principal | undefined,
    collection: string,
    id: string,
    superOnly = false,
  ) {
    const snap = await this.db.doc(`${collection}/${id}`).get();
    if (!snap.exists) throw new NotFoundError();
    const oid = String(snap.get("organizationId"));
    if (superOnly) this.superAdmin(p, oid);
    else this.admin(p, oid);
    return { id: snap.id, ...snap.data() };
  }
  async createResource(
    p: Principal | undefined,
    collection: string,
    input: Data,
    superOnly = false,
  ) {
    const oid = String(input.organizationId),
      actor = superOnly ? this.superAdmin(p, oid) : this.admin(p, oid),
      ref = this.db.collection(collection).doc();
    const reserved = new Set([
        "status",
        "version",
        "createdAt",
        "updatedAt",
        "organizationId",
      ]),
      supplied = (
        input.data && typeof input.data === "object" ? input.data : {}
      ) as Data;
    if (Object.keys(supplied).some((key) => reserved.has(key)))
      throw new BusinessRuleError(
        "RESERVED_FIELD",
        "Lifecycle fields are server controlled.",
      );
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...supplied,
        organizationId: oid,
        ...(input.name ? { name: input.name } : {}),
        status: "draft",
        version: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, oid, `${collection}.created`, { id: ref.id });
      return Promise.resolve();
    });
    return { id: ref.id, status: "draft", version: 1 };
  }
  async transitionResource(
    p: Principal | undefined,
    collection: string,
    id: string,
    version: number,
    action: "publish" | "archive",
    superOnly = false,
  ) {
    const ref = this.db.doc(`${collection}/${id}`),
      initial = await ref.get();
    if (!initial.exists) throw new NotFoundError();
    const oid = String(initial.get("organizationId")),
      actor = superOnly ? this.superAdmin(p, oid) : this.admin(p, oid);
    await this.db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (Number(current.get("version")) !== version)
        throw new ConflictError("Resource version is stale.");
      const status = String(current.get("status"));
      if (
        (action === "publish" && status !== "draft") ||
        (action === "archive" &&
          !["draft", "published", "active"].includes(status))
      )
        throw new ConflictError("Invalid lifecycle transition.");
      tx.update(ref, {
        status: action === "publish" ? "published" : "archived",
        version: version + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, oid, `${collection}.${action}ed`, {
        id,
        version: version + 1,
      });
    });
    return {
      id,
      status: action === "publish" ? "published" : "archived",
      version: version + 1,
    };
  }
  async users(
    p: Principal | undefined,
    query: {
      organizationId?: string | undefined;
      page: number;
      pageSize: number;
      sort: "updatedAt" | "-updatedAt";
    },
  ) {
    const { organizationId, page, pageSize, sort } = query;
    let users;
    if (organizationId) {
      this.superAdmin(p, organizationId);
      const memberships = await this.db
        .collection("memberships")
        .where("organizationId", "==", organizationId)
        .get();
      const ids = [
        ...new Set(memberships.docs.map((d) => String(d.get("userId")))),
      ];
      users = await Promise.all(
        ids.map((userId) => this.db.doc(`users/${userId}`).get()),
      );
    } else {
      requirePlatformSuperAdmin(p);
      users = (await this.db.collection("users").get()).docs;
    }
    const timestamp = (value: unknown) =>
      typeof value === "object" &&
      value !== null &&
      "toMillis" in value &&
      typeof value.toMillis === "function"
        ? (value as { toMillis(): number }).toMillis()
        : 0;
    const results = users
      .filter((u) => u.exists)
      .map((u) => ({
        id: u.id,
        displayName: u.get("displayName") ?? "",
        email: u.get("email") ?? null,
        status: u.get("status") ?? "active",
        roles: u.get("roles") ?? (u.get("role") ? [u.get("role")] : []),
        organizationIds:
          u.get("organizationIds") ??
          (u.get("organizationId") ? [u.get("organizationId")] : []),
        updatedAt: u.get("updatedAt") ?? null,
      }))
      .sort((a, b) => {
        const difference = timestamp(a.updatedAt) - timestamp(b.updatedAt);
        return (
          (sort === "-updatedAt" ? -difference : difference) ||
          a.id.localeCompare(b.id)
        );
      });
    const total = results.length;
    return {
      items: results.slice((page - 1) * pageSize, page * pageSize),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
  async listMemberships(
    p: Principal | undefined,
    query: {
      organizationId?: string | undefined;
      page: number;
      pageSize: number;
      sort: "updatedAt" | "-updatedAt";
    },
  ) {
    const { organizationId, page, pageSize, sort } = query;
    let membershipQuery = this.db.collection("memberships");
    if (organizationId) {
      this.superAdmin(p, organizationId);
      membershipQuery = membershipQuery.where(
        "organizationId",
        "==",
        organizationId,
      ) as typeof membershipQuery;
    } else {
      requirePlatformSuperAdmin(p);
    }
    const timestamp = (value: unknown) =>
      typeof value === "object" &&
      value !== null &&
      "toMillis" in value &&
      typeof value.toMillis === "function"
        ? (value as { toMillis(): number }).toMillis()
        : 0;
    const results: Array<Data & { id: string }> = (
      await membershipQuery.get()
    ).docs
      .map<Data & { id: string }>((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .sort((a, b) => {
        const difference = timestamp(a.updatedAt) - timestamp(b.updatedAt);
        return (
          (sort === "-updatedAt" ? -difference : difference) ||
          a.id.localeCompare(b.id)
        );
      });
    const total = results.length;
    return {
      items: results.slice((page - 1) * pageSize, page * pageSize),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
  private async scopedDocument(
    p: Principal | undefined,
    collection: string,
    id: string,
  ) {
    const snap = await this.db.doc(`${collection}/${id}`).get();
    if (!snap.exists) throw new NotFoundError();
    this.admin(p, String(snap.get("organizationId") ?? id));
    return { id: snap.id, ...snap.data() };
  }
  private audit(
    tx: Transaction,
    actorId: string,
    organizationId: string,
    event: string,
    subject: Data,
  ) {
    tx.create(this.db.collection("auditLogs").doc(randomUUID()), {
      event,
      actorId,
      organizationId,
      subject,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  async createOrganization(p: Principal | undefined, input: Data) {
    const actor = requirePlatformSuperAdmin(p);
    const ref = this.db.collection("organizations").doc();
    await this.db.runTransaction(async (tx) => {
      tx.create(ref, {
        ...input,
        status: "active",
        version: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, ref.id, "organization.created", {
        organizationId: ref.id,
      });
      tx.create(this.db.doc(`memberships/${ref.id}_${actor.uid}`), {
        userId: actor.uid,
        organizationId: ref.id,
        roles: ["super_admin"],
        status: "active",
        version: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return Promise.resolve();
    });
    return { id: ref.id };
  }
  async organization(p: Principal | undefined, id: string) {
    return this.scopedDocument(p, "organizations", id);
  }
  async organizations(p: Principal | undefined) {
    const actor = this.actor(p);
    if (
      !actor.roles.some(
        (role) =>
          role === "admin" ||
          role === "super_admin" ||
          role === "platform_super_admin",
      )
    )
      throw new AuthorizationError();
    if (actor.roles.includes("platform_super_admin")) {
      const all = await this.db.collection("organizations").get();
      return all.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
    }
    const organizationIds = [
      ...new Set(
        (actor.memberships ?? []).map(
          (membership) => membership.organizationId,
        ),
      ),
    ];
    if (organizationIds.length === 0) return [];
    const snapshots = await Promise.all(
      organizationIds.map((id) => this.db.doc(`organizations/${id}`).get()),
    );
    return snapshots
      .filter((snap) => snap.exists)
      .map((snap) => ({ id: snap.id, ...snap.data() }));
  }
  async updateOrganization(
    p: Principal | undefined,
    id: string,
    input: Data,
    status?: "active" | "suspended",
  ) {
    const actor = this.admin(p, id),
      ref = this.db.doc(`organizations/${id}`);
    await this.db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (!current.exists) throw new NotFoundError();
      const expected = Number(input.version);
      if (expected !== Number(current.get("version") ?? 1))
        throw new ConflictError("Organization version is stale.");
      const changes = { ...input };
      delete changes.version;
      tx.update(ref, {
        ...changes,
        ...(status ? { status } : {}),
        version: expected + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(
        tx,
        actor.uid,
        id,
        status
          ? `organization.${status === "active" ? "reactivated" : "suspended"}`
          : "organization.updated",
        { organizationId: id, version: expected + 1 },
      );
    });
    return { id, version: Number(input.version) + 1 };
  }
  async createProgram(p: Principal | undefined, input: Data) {
    const oid = String(input.organizationId);
    const actor = this.admin(p, oid);
    const ref = this.db.collection("programs").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...input,
        status: "active",
        version: 1,
        createdAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, oid, "program.created", { programId: ref.id });
      return Promise.resolve();
    });
    return { id: ref.id };
  }
  async onboardParent(p: Principal | undefined, input: Data) {
    const actor = this.actor(p);
    const oid = String(input.organizationId);
    if (
      !actor.memberships?.some(
        (membership) => membership.organizationId === oid,
      )
    )
      throw new AuthorizationError();
    const ref = this.db.doc(`parentProfiles/${actor.uid}`);
    await this.db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists)
        throw new ConflictError("Parent onboarding is already complete.");
      tx.create(ref, {
        ...input,
        userId: actor.uid,
        status:
          input.consentStatus === "granted"
            ? "pending_link"
            : "pending_consent",
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        this.db.doc(`memberships/${actor.uid}_${oid}_parent`),
        {
          userId: actor.uid,
          organizationId: oid,
          role: "parent",
          status: "active",
          version: 1,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (input.participantId) {
        const participant = await tx.get(
          this.db.doc(`participants/${textValue(input.participantId)}`),
        );
        if (!participant.exists || participant.get("organizationId") !== oid)
          throw new AuthorizationError();
        tx.create(
          this.db.doc(
            `parentChildLinks/${actor.uid}_${textValue(input.participantId)}`,
          ),
          {
            parentUid: actor.uid,
            participantId: input.participantId,
            organizationId: oid,
            status: "pending",
            effectiveAt: FieldValue.serverTimestamp(),
            expiresAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
        );
      }
      this.audit(tx, actor.uid, oid, "parent.onboarded", { userId: actor.uid });
    });
    return { id: actor.uid };
  }
  async createParticipant(p: Principal | undefined, input: Data) {
    const oid = String(input.organizationId);
    const { actor } = this.participantActor(
      p,
      "admin.participants.manage",
      oid,
    );
    const ref = this.db.collection("participants").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...input,
        status: "active",
        version: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.create(
        this.db.doc(
          `parentChildLinks/${String(input.guardianUserId)}_${ref.id}`,
        ),
        {
          parentUid: input.guardianUserId,
          participantId: ref.id,
          organizationId: oid,
          status: "active",
          effectiveAt: FieldValue.serverTimestamp(),
          expiresAt: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      );
      this.audit(tx, actor.uid, oid, "participant.created", {
        participantId: ref.id,
      });
      return Promise.resolve();
    });
    return { id: ref.id };
  }
  async participantOrganization(id: string) {
    const snap = await this.db.doc(`participants/${id}`).get();
    if (!snap.exists) throw new NotFoundError();
    return String(snap.get("organizationId"));
  }
  async updateParticipant(
    p: Principal | undefined,
    id: string,
    input: Data,
    archive = false,
  ) {
    const oid = await this.participantOrganization(id);
    const { actor } = this.participantActor(
      p,
      "admin.participants.manage",
      oid,
    );
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.doc(`participants/${id}`);
      const current = await tx.get(ref);
      if (!current.exists) throw new NotFoundError();
      const expected = archive
        ? Number(current.get("version") ?? 1)
        : Number(input.version);
      if (!archive && expected !== Number(current.get("version") ?? 1))
        throw new ConflictError("Participant version is stale.");
      const changes = { ...input };
      delete changes.version;
      tx.update(
        ref,
        archive
          ? {
              status: "archived",
              archivedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              version: expected + 1,
            }
          : {
              ...changes,
              version: expected + 1,
              updatedAt: FieldValue.serverTimestamp(),
            },
      );
      this.audit(
        tx,
        actor.uid,
        oid,
        archive ? "participant.archived" : "participant.updated",
        { participantId: id },
      );
    });
    return { id };
  }
  async participant(p: Principal | undefined, id: string) {
    const snap = await this.db.doc(`participants/${id}`).get();
    if (!snap.exists) throw new NotFoundError();
    this.participantActor(
      p,
      "admin.participants.read",
      String(snap.get("organizationId")),
    );
    return { id: snap.id, ...snap.data() };
  }
  async roster(
    p: Principal | undefined,
    input: {
      organizationId?: string | undefined;
      page: number;
      pageSize: number;
      search?: string | undefined;
      status?: string | undefined;
      teamId?: string | undefined;
      programId?: string | undefined;
      sort: "updatedAt" | "-updatedAt";
    },
  ) {
    const { organizationId: oid } = this.participantActor(
      p,
      "admin.participants.read",
      input.organizationId,
    );
    let participantQuery = this.db
      .collection("participants")
      .where("organizationId", "==", oid);
    if (input.programId)
      participantQuery = participantQuery.where(
        "programId",
        "==",
        input.programId,
      );
    if (input.status)
      participantQuery = participantQuery.where("status", "==", input.status);
    if (input.teamId)
      participantQuery = participantQuery.where(
        "activeTeamId",
        "==",
        input.teamId,
      );
    const timestamp = (value: unknown) =>
      typeof value === "object" &&
      value !== null &&
      "toMillis" in value &&
      typeof value.toMillis === "function"
        ? (value as { toMillis(): number }).toMillis()
        : value instanceof Date
          ? value.getTime()
          : 0;
    const normalizedSearch = input.search?.toLocaleLowerCase();
    const results = (await participantQuery.get()).docs
      .map<Data & { id: string }>((doc) => ({ id: doc.id, ...doc.data() }))
      .filter(
        (participant) =>
          !normalizedSearch ||
          textValue(participant.displayName)
            .toLocaleLowerCase()
            .includes(normalizedSearch),
      )
      .sort((a, b) => {
        const difference = timestamp(a.updatedAt) - timestamp(b.updatedAt);
        return (
          (input.sort === "-updatedAt" ? -difference : difference) ||
          a.id.localeCompare(b.id)
        );
      });
    const total = results.length;
    return {
      items: results.slice(
        (input.page - 1) * input.pageSize,
        input.page * input.pageSize,
      ),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: Math.ceil(total / input.pageSize),
      },
    };
  }
  async createTeam(p: Principal | undefined, input: Data) {
    const oid = String(input.organizationId);
    const actor = this.admin(p, oid);
    const ref = this.db.collection("teams").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...input,
        status: "active",
        version: 1,
        memberCount: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, oid, "team.created", { teamId: ref.id });
      return Promise.resolve();
    });
    return { id: ref.id };
  }
  async teamOrganization(id: string) {
    const snap = await this.db.doc(`teams/${id}`).get();
    if (!snap.exists) throw new NotFoundError();
    return String(snap.get("organizationId"));
  }
  async updateTeam(p: Principal | undefined, id: string, input: Data) {
    const oid = await this.teamOrganization(id);
    const actor = this.admin(p, oid);
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.doc(`teams/${id}`),
        current = await tx.get(ref);
      if (!current.exists) throw new NotFoundError();
      const expected = Number(input.version);
      if (expected !== Number(current.get("version") ?? 1))
        throw new ConflictError("Team version is stale.");
      if (
        input.capacity !== undefined &&
        Number(input.capacity) < Number(current.get("memberCount") ?? 0)
      )
        throw new BusinessRuleError(
          "TEAM_CAPACITY",
          "Capacity cannot be below the active roster size.",
        );
      const changes = { ...input };
      delete changes.version;
      tx.update(ref, {
        ...changes,
        version: expected + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, oid, "team.updated", { teamId: id });
      return Promise.resolve();
    });
    return { id };
  }
  async team(p: Principal | undefined, id: string) {
    return this.scopedDocument(p, "teams", id);
  }
  async teams(
    p: Principal | undefined,
    oid: string,
    query?: TeamListQueryInput,
  ) {
    this.admin(p, oid);
    let q: FirebaseFirestore.Query = this.db
      .collection("teams")
      .where("organizationId", "==", oid);

    if (query?.status) {
      q = q.where("status", "==", query.status);
    }

    const snap = await q.get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 25;
    const total = items.length;

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }
  async assignTeamMember(
    p: Principal | undefined,
    teamId: string,
    participantId: string,
    remove = false,
  ) {
    const oid = await this.teamOrganization(teamId);
    const actor = this.admin(p, oid);
    if ((await this.participantOrganization(participantId)) !== oid)
      throw new AuthorizationError();
    const ref = this.db.doc(
      `teamMembers/${teamId}_participant_${participantId}`,
    );
    await this.db.runTransaction(async (tx) => {
      const teamRef = this.db.doc(`teams/${teamId}`),
        team = await tx.get(teamRef),
        existing = await tx.get(ref);
      if (!team.exists || team.get("status") !== "active")
        throw new ConflictError("Team is not active.");
      const wasActive = existing.exists && existing.get("status") === "active";
      const count = Number(team.get("memberCount") ?? 0);
      if (!remove && !wasActive && count >= Number(team.get("capacity")))
        throw new BusinessRuleError(
          "TEAM_CAPACITY",
          "Team capacity has been reached.",
        );
      tx.set(
        ref,
        {
          teamId,
          participantId,
          organizationId: oid,
          role: "participant",
          status: remove ? "revoked" : "active",
          effectiveAt: FieldValue.serverTimestamp(),
          expiresAt: null,
          createdAt: existing.exists
            ? existing.get("createdAt")
            : FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (wasActive !== !remove)
        tx.update(teamRef, {
          memberCount: FieldValue.increment(remove ? -1 : 1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      tx.update(this.db.doc(`participants/${participantId}`), {
        activeTeamId: remove ? FieldValue.delete() : teamId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(
        tx,
        actor.uid,
        oid,
        remove ? "team.member_removed" : "team.member_assigned",
        { teamId, participantId },
      );
      return Promise.resolve();
    });
    return { id: ref.id };
  }
  async invite(p: Principal | undefined, input: Data) {
    const oid = String(input.organizationId);
    const actor = this.admin(p, oid);
    const expiry = Timestamp.fromDate(new Date(String(input.expiresAt)));
    if (expiry.toMillis() <= Date.now())
      throw new BusinessRuleError(
        "INVITATION_EXPIRED",
        "Invitation expiry must be in the future.",
      );
    const ref = this.db.collection("adultInvitations").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...input,
        email: String(input.email).toLowerCase(),
        expiresAt: expiry,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, oid, "invitation.created", {
        invitationId: ref.id,
        role: input.role,
      });
      return Promise.resolve();
    });
    return { id: ref.id };
  }
  async acceptInvitation(p: Principal | undefined, id: string) {
    const actor = this.actor(p);
    const ref = this.db.doc(`adultInvitations/${id}`);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError();
      if (snap.get("status") !== "pending") throw new ConflictError();
      if ((snap.get("expiresAt") as Timestamp).toMillis() <= Date.now())
        throw new BusinessRuleError(
          "INVITATION_EXPIRED",
          "Invitation has expired.",
        );
      const email = (actor.token.email ?? "").toLowerCase();
      if (!email || email !== snap.get("email")) throw new AuthorizationError();
      tx.update(ref, {
        status: "accepted",
        acceptedBy: actor.uid,
        acceptedAt: FieldValue.serverTimestamp(),
      });
      this.audit(
        tx,
        actor.uid,
        String(snap.get("organizationId")),
        "invitation.accepted",
        { invitationId: id },
      );
    });
    return { id };
  }
  async decideInvitation(
    p: Principal | undefined,
    id: string,
    decision: "approve" | "revoke",
  ) {
    const ref = this.db.doc(`adultInvitations/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundError();
    const oid = String(snap.get("organizationId"));
    const actor = this.admin(p, oid);
    await this.db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (decision === "approve" && current.get("status") !== "accepted")
        throw new ConflictError("Invitation must be accepted before approval.");
      tx.update(ref, {
        status: decision === "approve" ? "approved" : "revoked",
        decidedAt: FieldValue.serverTimestamp(),
        decidedBy: actor.uid,
      });
      if (decision === "approve")
        tx.set(
          this.db.doc(
            `memberships/${String(current.get("acceptedBy"))}_${oid}_${String(current.get("role"))}`,
          ),
          {
            userId: current.get("acceptedBy"),
            organizationId: oid,
            role: current.get("role"),
            status: "active",
            createdAt: FieldValue.serverTimestamp(),
          },
        );
      this.audit(tx, actor.uid, oid, `invitation.${decision}d`, {
        invitationId: id,
      });
    });
    return { id };
  }
  async captureConsent(p: Principal | undefined, input: Data) {
    const actor = this.actor(p);
    const oid = String(input.organizationId),
      participantId = String(input.participantId);
    if (
      !actor.organizationIds.includes(oid) ||
      (await this.participantOrganization(participantId)) !== oid
    )
      throw new AuthorizationError();
    const link = await this.db
      .doc(`parentChildLinks/${actor.uid}_${participantId}`)
      .get();
    if (!link.exists || link.get("status") !== "active")
      throw new AuthorizationError();
    const policy = await this.db
      .doc(
        `consentPolicies/${String(input.policyKey)}_${String(input.policyVersion)}`,
      )
      .get();
    if (
      !policy.exists ||
      policy.get("status") !== "approved" ||
      policy.get("organizationId") !== oid ||
      policy.get("legalTextReference") !== input.legalTextReference
    )
      throw new BusinessRuleError(
        "CONSENT_POLICY_NOT_APPROVED",
        "Consent can only be recorded against approved legal text.",
      );
    const ref = this.db.collection("consentEvents").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...input,
        guardianUserId: actor.uid,
        action: "granted",
        effectiveAt: FieldValue.serverTimestamp(),
        occurredAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        this.db.doc(
          `activeConsents/${participantId}_${String(input.policyKey)}`,
        ),
        {
          ...input,
          guardianUserId: actor.uid,
          consentEventId: ref.id,
          status: "granted",
          effectiveAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      );
      this.audit(tx, actor.uid, oid, "consent.granted", {
        participantId,
        policyKey: input.policyKey,
        policyVersion: input.policyVersion,
      });
      return Promise.resolve();
    });
    return { id: ref.id };
  }
  async withdrawConsent(
    p: Principal | undefined,
    participantId: string,
    policyKey: string,
  ) {
    const actor = this.actor(p),
      oid = await this.participantOrganization(participantId);
    const link = await this.db
      .doc(`parentChildLinks/${actor.uid}_${participantId}`)
      .get();
    if (!link.exists || link.get("status") !== "active")
      throw new AuthorizationError();
    const active = this.db.doc(`activeConsents/${participantId}_${policyKey}`),
      event = this.db.collection("consentEvents").doc();
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(active);
      if (!snap.exists || snap.get("status") !== "granted")
        throw new ConflictError("No active consent exists.");
      tx.create(event, {
        organizationId: oid,
        participantId,
        policyKey,
        policyVersion: snap.get("policyVersion"),
        guardianUserId: actor.uid,
        legalTextReference: snap.get("legalTextReference"),
        action: "withdrawn",
        effectiveAt: FieldValue.serverTimestamp(),
        occurredAt: FieldValue.serverTimestamp(),
      });
      tx.update(active, {
        status: "withdrawn",
        withdrawalEventId: event.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, oid, "consent.withdrawn", {
        participantId,
        policyKey,
      });
    });
    return { id: event.id };
  }
  async consentHistory(p: Principal | undefined, participantId: string) {
    const actor = this.actor(p),
      oid = await this.participantOrganization(participantId);
    const isAdmin =
      actor.roles.some((role) => role === "admin" || role === "super_admin") &&
      actor.organizationIds.includes(oid);
    const link = await this.db
      .doc(`parentChildLinks/${actor.uid}_${participantId}`)
      .get();
    if (!isAdmin && (!link.exists || link.get("status") !== "active"))
      throw new AuthorizationError();
    const snap = await this.db
      .collection("consentEvents")
      .where("participantId", "==", participantId)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async assignTeamMentor(
    p: Principal | undefined,
    teamId: string,
    userId: string,
    expiresAt?: string,
    remove = false,
  ) {
    const oid = await this.teamOrganization(teamId),
      actor = this.admin(p, oid);
    const membership = await this.db
      .collection("memberships")
      .where("userId", "==", userId)
      .where("organizationId", "==", oid)
      .where("status", "==", "active")
      .get();
    if (
      !remove &&
      !membership.docs.some(
        (doc) =>
          doc.get("role") === "mentor" ||
          (doc.get("roles") as unknown[] | undefined)?.includes("mentor"),
      )
    )
      throw new AuthorizationError();
    const ref = this.db.doc(`teamMembers/${teamId}_mentor_${userId}`);
    await this.db.runTransaction((tx) => {
      tx.set(
        ref,
        {
          teamId,
          userId,
          organizationId: oid,
          role: "mentor",
          status: remove ? "revoked" : "active",
          effectiveAt: FieldValue.serverTimestamp(),
          expiresAt: expiresAt ? Timestamp.fromDate(new Date(expiresAt)) : null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      this.audit(
        tx,
        actor.uid,
        oid,
        remove ? "team.mentor_removed" : "team.mentor_assigned",
        { teamId, userId },
      );
      return Promise.resolve();
    });
    return { id: ref.id };
  }
  async createRelationship(p: Principal | undefined, input: Data) {
    const oid = String(input.organizationId),
      actor = this.admin(p, oid),
      participantId = String(input.participantId);
    if ((await this.participantOrganization(participantId)) !== oid)
      throw new AuthorizationError();
    const collection =
      input.type === "parent" ? "parentChildLinks" : "observerGrants";
    const ref = this.db.doc(
      `${collection}/${String(input.userId)}_${participantId}`,
    );
    await this.db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists)
        throw new ConflictError("Relationship already exists.");
      tx.create(ref, {
        organizationId: oid,
        participantId,
        ...(input.type === "parent"
          ? { parentUid: input.userId }
          : { userId: input.userId }),
        status: input.status,
        effectiveAt: input.effectiveAt
          ? Timestamp.fromDate(new Date(textValue(input.effectiveAt)))
          : FieldValue.serverTimestamp(),
        expiresAt: input.expiresAt
          ? Timestamp.fromDate(new Date(textValue(input.expiresAt)))
          : null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, oid, "relationship.created", {
        relationshipId: ref.id,
        type: input.type,
        participantId,
      });
    });
    return { id: ref.id, status: input.status };
  }
  async activateRelationship(p: Principal | undefined, id: string) {
    const candidates = [
      this.db.doc(`parentChildLinks/${id}`),
      this.db.doc(`observerGrants/${id}`),
    ];
    const snapshots = await Promise.all(candidates.map((ref) => ref.get()));
    const index = snapshots.findIndex((snap) => snap.exists);
    if (index < 0) throw new NotFoundError();
    const ref = candidates[index]!,
      oid = String(snapshots[index]!.get("organizationId")),
      actor = this.admin(p, oid);
    await this.db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.get("status") !== "pending") throw new ConflictError();
      tx.update(ref, {
        status: "active",
        activatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, oid, "relationship.activated", {
        relationshipId: id,
      });
    });
    return { id, status: "active" };
  }
  async memberships(p: Principal | undefined, oid: string) {
    this.admin(p, oid);
    const snap = await this.db
      .collection("memberships")
      .where("organizationId", "==", oid)
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }
  async setMembership(
    p: Principal | undefined,
    oid: string,
    userId: string,
    role: Role,
    status: string,
    version?: number,
    expiresAt?: string | null,
  ) {
    const actor = this.admin(p, oid);
    if (role === "super_admin" && !actor.roles.includes("super_admin"))
      throw new AuthorizationError();
    const ref = this.db.doc(`memberships/${userId}_${oid}_${role}`);
    await this.db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      const currentVersion = Number(current.get("version") ?? 0);
      if (current.exists && version !== undefined && version !== currentVersion)
        throw new ConflictError("Membership version is stale.");
      if (
        current.exists &&
        status !== "active" &&
        (role === "admin" || role === "super_admin")
      ) {
        const privileged = await tx.get(
          this.db
            .collection("memberships")
            .where("organizationId", "==", oid)
            .where("status", "==", "active"),
        );
        const remaining = privileged.docs.filter(
          (doc) =>
            doc.id !== ref.id &&
            ["admin", "super_admin"].includes(String(doc.get("role"))),
        );
        if (remaining.length === 0)
          throw new BusinessRuleError(
            "LAST_TENANT_ADMIN",
            "The last active tenant administrator cannot be removed.",
          );
      }
      tx.set(
        ref,
        {
          userId,
          organizationId: oid,
          role,
          status,
          version: currentVersion + 1,
          expiresAt: expiresAt ? Timestamp.fromDate(new Date(expiresAt)) : null,
          createdAt: current.exists
            ? current.get("createdAt")
            : FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      this.audit(tx, actor.uid, oid, "membership.changed", {
        userId,
        role,
        status,
      });
      return Promise.resolve();
    });
    if (status !== "active") await this.auth.revokeRefreshTokens(userId);
    return { id: ref.id };
  }
}
