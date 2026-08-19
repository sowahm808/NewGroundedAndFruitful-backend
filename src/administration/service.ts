import type { Auth } from "firebase-admin/auth";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { requireAuthenticated, type Principal } from "../auth/authorization.js";
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from "../shared/errors.js";
import type { Role } from "../auth/roles.js";

type Data = Record<string, unknown>;
export class AdministrationService {
  constructor(
    private db: Firestore,
    private auth: Auth,
  ) {}
  private actor(p: Principal | undefined) {
    return requireAuthenticated(p);
  }
  private admin(p: Principal | undefined, organizationId: string) {
    const actor = this.actor(p);
    if (
      !actor.roles.some((r) => r === "admin" || r === "super_admin") ||
      (!actor.roles.includes("super_admin") &&
        !actor.organizationIds.includes(organizationId))
    )
      throw new AuthorizationError();
    return actor;
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
    const actor = this.actor(p);
    if (!actor.roles.includes("super_admin")) throw new AuthorizationError();
    const ref = this.db.collection("organizations").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...input,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, ref.id, "organization.created", {
        organizationId: ref.id,
      });
      return Promise.resolve();
    });
    return { id: ref.id };
  }
  async createProgram(p: Principal | undefined, input: Data) {
    const oid = String(input.organizationId);
    const actor = this.admin(p, oid);
    const ref = this.db.collection("programs").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...input,
        status: "active",
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
      !actor.organizationIds.includes(oid) &&
      !actor.roles.includes("super_admin")
    )
      throw new AuthorizationError();
    const ref = this.db.doc(`parentProfiles/${actor.uid}`);
    await this.db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists)
        throw new ConflictError("Parent onboarding is already complete.");
      tx.create(ref, {
        ...input,
        userId: actor.uid,
        status: "active",
        onboardedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, oid, "parent.onboarded", { userId: actor.uid });
    });
    return { id: actor.uid };
  }
  async createParticipant(p: Principal | undefined, input: Data) {
    const oid = String(input.organizationId);
    const actor = this.admin(p, oid);
    const ref = this.db.collection("participants").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...input,
        status: "active",
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
          createdAt: FieldValue.serverTimestamp(),
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
    const actor = this.admin(p, oid);
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.doc(`participants/${id}`);
      if (!(await tx.get(ref)).exists) throw new NotFoundError();
      tx.update(
        ref,
        archive
          ? {
              status: "archived",
              archivedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            }
          : { ...input, updatedAt: FieldValue.serverTimestamp() },
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
  async roster(p: Principal | undefined, oid: string, programId?: string) {
    this.admin(p, oid);
    let query = this.db
      .collection("participants")
      .where("organizationId", "==", oid);
    if (programId) query = query.where("programId", "==", programId);
    const snap = await query.get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async createTeam(p: Principal | undefined, input: Data) {
    const oid = String(input.organizationId);
    const actor = this.admin(p, oid);
    const ref = this.db.collection("teams").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...input,
        status: "active",
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
    await this.db.runTransaction((tx) => {
      tx.update(this.db.doc(`teams/${id}`), {
        ...input,
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, oid, "team.updated", { teamId: id });
      return Promise.resolve();
    });
    return { id };
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
    await this.db.runTransaction((tx) => {
      tx.set(
        ref,
        {
          teamId,
          participantId,
          organizationId: oid,
          role: "participant",
          status: remove ? "revoked" : "active",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
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
    const ref = this.db.collection("consentEvents").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...input,
        guardianUserId: actor.uid,
        action: "granted",
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
        action: "withdrawn",
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
      actor.roles.includes("super_admin") ||
      (actor.roles.includes("admin") && actor.organizationIds.includes(oid));
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
  async setMembership(
    p: Principal | undefined,
    oid: string,
    userId: string,
    role: Role,
    status: string,
  ) {
    const actor = this.admin(p, oid);
    if (role === "super_admin" && !actor.roles.includes("super_admin"))
      throw new AuthorizationError();
    const ref = this.db.doc(`memberships/${userId}_${oid}_${role}`);
    await this.db.runTransaction((tx) => {
      tx.set(
        ref,
        {
          userId,
          organizationId: oid,
          role,
          status,
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
