import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { AuthorizationError } from "../shared/errors.js";
import type { Role as UserRole } from "./roles.js";

export type { UserRole };

export const permissions = [
  "journey.self.read", "journey.self.write", "checkin.self.read", "checkin.self.write",
  "character.self.read", "character.self.write", "bible.self.read", "bible.self.write",
  "reading.self.read", "reading.self.write", "project.self.read", "project.self.write",
  "points.self.read", "team.composite.read", "child.linked.read",
  "observation.linked.create", "observation.own.read", "family.linked.read",
  "family.linked.complete", "support.linked.create", "support.own.read", "report.linked.read",
  "team.assigned.read", "project.assigned.guide", "reading.assigned.read",
  "encouragement.assigned.manage", "observation.granted.create",
  "observation.granted.read-own", "program.read", "program.configure", "content.manage",
  "quarter.manage", "team.manage", "participant.manage", "report.scoped.read",
  "organization.manage", "membership.manage", "role.manage", "invitation.manage",
  "consent.manage", "audit.read",
] as const;

export type Permission = (typeof permissions)[number];
export type MembershipStatus = "pending" | "active" | "suspended" | "revoked";
export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  roles: readonly UserRole[];
  status: MembershipStatus;
  version: number;
  /** An absent list means organization-wide program scope. */
  programIds?: readonly string[];
}
export type ActiveMembership = Membership & { status: "active" };
const isActiveMembership = (membership: Membership): membership is ActiveMembership =>
  membership.status === "active";
export interface AuthorizationContext {
  actorUid: string;
  roles: readonly UserRole[];
  organizationIds: readonly string[];
  memberships: readonly ActiveMembership[];
  authorizationSource?: "membership" | "legacy_user_profile";
}
export interface ResourceScope {
  organizationId: string;
  programId?: string;
  participantId?: string;
  teamId?: string;
}

const self = ["journey.self.read", "journey.self.write", "checkin.self.read", "checkin.self.write", "character.self.read", "character.self.write", "bible.self.read", "bible.self.write", "reading.self.read", "reading.self.write", "project.self.read", "project.self.write", "points.self.read", "team.composite.read"] as const;
const parent = ["child.linked.read", "observation.linked.create", "observation.own.read", "family.linked.read", "family.linked.complete", "support.linked.create", "support.own.read", "report.linked.read", "team.composite.read"] as const;
const mentor = ["team.assigned.read", "project.assigned.guide", "reading.assigned.read", "encouragement.assigned.manage", "team.composite.read"] as const;
const observer = ["observation.granted.create", "observation.granted.read-own"] as const;
const admin = ["program.read", "program.configure", "content.manage", "quarter.manage", "team.manage", "participant.manage", "report.scoped.read"] as const;
const tenant = ["organization.manage", "membership.manage", "role.manage", "invitation.manage", "consent.manage", "audit.read"] as const;
export const rolePermissions: Readonly<Record<UserRole, readonly Permission[]>> = {
  child: self, parent, mentor, observer, admin,
  super_admin: [...admin, ...tenant],
  platform_super_admin: [...admin, ...tenant],
};

export interface RelationshipReader {
  ownsParticipant(actorUid: string, resource: ResourceScope): Promise<boolean>;
  hasParentLink(actorUid: string, resource: ResourceScope): Promise<boolean>;
  hasMentorAssignment(actorUid: string, resource: ResourceScope): Promise<boolean>;
  hasObserverGrant(actorUid: string, resource: ResourceScope, now: Date): Promise<boolean>;
}

const childPermissions = new Set<Permission>(self);
const parentPermissions = new Set<Permission>(parent);
const mentorPermissions = new Set<Permission>(mentor);
const observerPermissions = new Set<Permission>(observer);
const programPermissions = new Set<Permission>(admin);

/** Central policy: permission, active tenant membership, scope, then relationship. */
export class AuthorizationPolicy {
  constructor(private readonly relationships: RelationshipReader, private readonly clock = () => new Date()) {}

  async authorize(context: AuthorizationContext, permission: Permission, resource: ResourceScope): Promise<void> {
    const platformOperator = context.roles.includes("platform_super_admin");
    const memberships = context.memberships.filter(isActiveMembership).filter((membership) =>
      membership.userId === context.actorUid &&
      membership.organizationId === resource.organizationId);
    if (memberships.length === 0 && !platformOperator) throw new AuthorizationError();

    const eligible = memberships.filter((membership) => membership.roles.some((role) =>
      rolePermissions[role].includes(permission)));
    const eligibleRoles = platformOperator
      ? (["platform_super_admin"] as const).filter((role) => rolePermissions[role].includes(permission))
      : [];
    if (eligible.length === 0 && eligibleRoles.length === 0) throw new AuthorizationError();
    if (programPermissions.has(permission) && resource.programId &&
      !platformOperator && !eligible.some((membership) => !membership.programIds || membership.programIds.includes(resource.programId!)))
      throw new AuthorizationError();

    let related = true;
    if (childPermissions.has(permission)) related = Boolean(resource.participantId) && await this.relationships.ownsParticipant(context.actorUid, resource);
    else if (parentPermissions.has(permission)) related = Boolean(resource.participantId) && await this.relationships.hasParentLink(context.actorUid, resource);
    else if (mentorPermissions.has(permission)) related = Boolean(resource.teamId) && await this.relationships.hasMentorAssignment(context.actorUid, resource);
    else if (observerPermissions.has(permission)) related = Boolean(resource.participantId) && await this.relationships.hasObserverGrant(context.actorUid, resource, this.clock());
    if (!related) throw new AuthorizationError();
  }
}

function date(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value) return (value as Timestamp).toDate();
  return undefined;
}

/** Firestore adapter always queries within the supplied tenant and validates loaded fields. */
export class FirestoreRelationshipReader implements RelationshipReader {
  constructor(private readonly db: Firestore) {}
  async ownsParticipant(uid: string, r: ResourceScope) {
    if (!r.participantId) return false;
    const doc = await this.db.doc(`participants/${r.participantId}`).get();
    return doc.exists && doc.get("firebaseUid") === uid && doc.get("organizationId") === r.organizationId && doc.get("status") !== "archived";
  }
  async hasParentLink(uid: string, r: ResourceScope) {
    if (!r.participantId) return false;
    const snap = await this.db.collection("parentChildLinks").where("organizationId", "==", r.organizationId).where("parentUid", "==", uid).where("participantId", "==", r.participantId).where("status", "==", "active").limit(1).get();
    return snap.docs.some((d) => d.get("revokedAt") == null && d.get("organizationId") === r.organizationId);
  }
  async hasMentorAssignment(uid: string, r: ResourceScope) {
    if (!r.teamId) return false;
    const snap = await this.db.collection("mentorAssignments").where("organizationId", "==", r.organizationId).where("mentorUid", "==", uid).where("teamId", "==", r.teamId).where("status", "==", "active").limit(1).get();
    return snap.docs.some((d) => d.get("revokedAt") == null && d.get("organizationId") === r.organizationId);
  }
  async hasObserverGrant(uid: string, r: ResourceScope, now: Date) {
    if (!r.participantId) return false;
    const snap = await this.db.collection("observerGrants").where("organizationId", "==", r.organizationId).where("observerUid", "==", uid).where("participantId", "==", r.participantId).where("status", "==", "active").limit(5).get();
    return snap.docs.some((d) => d.get("revokedAt") == null && (!date(d.get("expiresAt")) || date(d.get("expiresAt"))! > now));
  }
}
