import {
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { z } from "zod";
import {
  AuthorizationError,
  ConflictError,
  ValidationError,
} from "../shared/errors.js";

export const capabilities = [
  "organizations.manage",
  "memberships.manage",
  "quarters.manage",
  "bible.publish",
  "roles.elevate",
  "platform.audit.read",
] as const;
export const elevationGrantSchema = z
  .object({
    userId: z.string().min(1).max(128),
    roles: z.array(z.string().min(1).max(64)).max(10).default([]),
    capabilities: z
      .array(z.enum(capabilities))
      .max(capabilities.length)
      .default([]),
    scope: z.discriminatedUnion("type", [
      z.object({ type: z.literal("platform") }),
      z.object({
        type: z.literal("workspace"),
        workspaceId: z.string().min(1).max(128),
      }),
    ]),
    reason: z.string().trim().min(8).max(500),
    startsAt: z.coerce.date(),
    expiresAt: z.coerce.date(),
    maxUses: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine(
    (v) => v.roles.length + v.capabilities.length > 0,
    "A role or capability is required",
  );

export interface EffectiveElevation {
  id: string;
  roles: string[];
  capabilities: string[];
  scope: { type: "platform" } | { type: "workspace"; workspaceId: string };
  expiresAt: Date;
}

export class ElevationService {
  static readonly MAX_DURATION_MS = 8 * 60 * 60 * 1000;
  constructor(private readonly db: Firestore) {}

  async grant(grantedBy: string, recentAuthentication: boolean, raw: unknown) {
    const parsed = elevationGrantSchema.safeParse(raw);
    if (!parsed.success)
      throw new ValidationError("Invalid elevation grant.", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    const input = parsed.data;
    if (input.userId === grantedBy) throw new AuthorizationError();
    if (!recentAuthentication) throw new AuthorizationError();
    if (
      input.expiresAt <= input.startsAt ||
      input.expiresAt.getTime() - input.startsAt.getTime() >
        ElevationService.MAX_DURATION_MS
    )
      throw new ValidationError(
        "Elevation expiration must be bounded to eight hours.",
      );
    const now = FieldValue.serverTimestamp();
    const ref = this.db.collection("elevationGrants").doc();
    await this.db.runTransaction((tx) => {
      tx.create(ref, {
        ...input,
        startsAt: Timestamp.fromDate(input.startsAt),
        expiresAt: Timestamp.fromDate(input.expiresAt),
        grantedBy,
        usageCount: 0,
        status: "active",
        createdAt: now,
        revokedAt: null,
      });
      tx.create(this.db.collection("auditLogs").doc(), {
        event: "elevation.granted",
        grantId: ref.id,
        actorId: grantedBy,
        targetUid: input.userId,
        scope: input.scope,
        reason: input.reason,
        createdAt: now,
      });
      return Promise.resolve();
    });
    return {
      id: ref.id,
      ...input,
      grantedBy,
      usageCount: 0,
      status: "active" as const,
    };
  }

  async revoke(grantId: string, actorId: string) {
    const ref = this.db.doc(`elevationGrants/${grantId}`);
    await this.db.runTransaction(async (tx) => {
      const grant = await tx.get(ref);
      if (!grant.exists)
        throw new ConflictError("Elevation grant does not exist.");
      if (grant.get("status") === "revoked") return;
      const now = FieldValue.serverTimestamp();
      tx.update(ref, { status: "revoked", revokedAt: now, revokedBy: actorId });
      tx.create(this.db.collection("auditLogs").doc(), {
        event: "elevation.revoked",
        grantId,
        actorId,
        targetUid: grant.get("userId"),
        createdAt: now,
      });
    });
    return { id: grantId, status: "revoked" as const };
  }

  async activeForUser(
    uid: string,
    workspaceId?: string,
  ): Promise<EffectiveElevation[]> {
    const snapshot = await this.db
      .collection("elevationGrants")
      .where("userId", "==", uid)
      .where("status", "==", "active")
      .get();
    const now = Date.now();
    return snapshot.docs.flatMap((doc) => {
      const d = doc.data();
      const usageCount = typeof d.usageCount === "number" ? d.usageCount : 0;
      const maxUses = typeof d.maxUses === "number" ? d.maxUses : undefined;
      const expires =
        d.expiresAt instanceof Timestamp ? d.expiresAt.toDate() : new Date(0);
      const starts =
        d.startsAt instanceof Timestamp ? d.startsAt.toMillis() : 0;
      if (
        starts > now ||
        expires.getTime() <= now ||
        (maxUses != null && usageCount >= maxUses)
      )
        return [];
      if (d.scope?.type === "workspace" && d.scope.workspaceId !== workspaceId)
        return [];
      return [
        {
          id: doc.id,
          roles: Array.isArray(d.roles) ? d.roles : [],
          capabilities: Array.isArray(d.capabilities) ? d.capabilities : [],
          scope: d.scope,
          expiresAt: expires,
        },
      ];
    });
  }

  /** Transactionally consumes a limited grant; concurrent requests cannot reuse it. */
  async consume(grantId: string, uid: string, workspaceId?: string) {
    return this.db.runTransaction(async (tx) => {
      const ref = this.db.doc(`elevationGrants/${grantId}`);
      const grant = await tx.get(ref);
      const d = grant.data();
      const now = Timestamp.now();
      const startsAt = d?.startsAt instanceof Timestamp ? d.startsAt : null;
      const expiresAt = d?.expiresAt instanceof Timestamp ? d.expiresAt : null;
      const usageCount = typeof d?.usageCount === "number" ? d.usageCount : 0;
      const maxUses = typeof d?.maxUses === "number" ? d.maxUses : undefined;
      if (
        !d ||
        !startsAt ||
        !expiresAt ||
        d.userId !== uid ||
        d.status !== "active" ||
        startsAt.toMillis() > now.toMillis() ||
        expiresAt.toMillis() <= now.toMillis() ||
        (d.scope.type === "workspace" && d.scope.workspaceId !== workspaceId) ||
        (maxUses != null && usageCount >= maxUses)
      )
        throw new AuthorizationError();
      tx.update(ref, {
        usageCount: FieldValue.increment(1),
        ...(maxUses != null && usageCount + 1 >= maxUses
          ? { status: "consumed" }
          : {}),
      });
      tx.create(this.db.collection("auditLogs").doc(), {
        event: "elevation.used",
        grantId,
        actorId: uid,
        workspaceId: workspaceId ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { id: grantId, usageCount: usageCount + 1 };
    });
  }
}
