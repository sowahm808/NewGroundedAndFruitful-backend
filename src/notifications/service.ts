import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import type { Principal } from "../auth/authorization.js";
import { requireAuthenticated } from "../auth/authorization.js";
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from "../shared/errors.js";
import {
  notificationBackoffMs,
  redactNotificationData,
  type NotificationChannel,
} from "./domain.js";

type Input = {
  organizationId: string;
  recipientUserId: string;
  channel: NotificationChannel;
  templateKey: string;
  templateVersion: string;
  data: Record<string, string | number | boolean>;
  idempotencyKey: string;
};
export interface NotificationProvider {
  send(message: {
    channel: NotificationChannel;
    recipientUserId: string;
    templateKey: string;
    templateVersion: string;
    data: Record<string, unknown>;
  }): Promise<{ providerMessageId: string }>;
}

export class NotificationService {
  constructor(private db: Firestore) {}
  private actor(p: Principal | undefined) {
    return requireAuthenticated(p);
  }
  async setPreference(
    p: Principal | undefined,
    input: {
      organizationId: string;
      channel: NotificationChannel;
      enabled: boolean;
    },
  ) {
    const actor = this.actor(p);
    if (!actor.organizationIds.includes(input.organizationId))
      throw new AuthorizationError();
    const id = `${actor.uid}_${input.organizationId}_${input.channel}`;
    await this.db
      .doc(`notificationPreferences/${id}`)
      .set(
        {
          ...input,
          userId: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    return { id, ...input };
  }
  async preferences(p: Principal | undefined, organizationId: string) {
    const actor = this.actor(p);
    if (!actor.organizationIds.includes(organizationId))
      throw new AuthorizationError();
    const snap = await this.db
      .collection("notificationPreferences")
      .where("organizationId", "==", organizationId)
      .where("userId", "==", actor.uid)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async enqueue(p: Principal | undefined, input: Input) {
    const actor = this.actor(p);
    if (
      !actor.roles.some((r) => r === "admin" || r === "super_admin") ||
      !actor.organizationIds.includes(input.organizationId)
    )
      throw new AuthorizationError();
    const template = await this.db
      .doc(
        `notificationTemplates/${input.templateKey}_${input.templateVersion}`,
      )
      .get();
    if (
      !template.exists ||
      template.get("status") !== "approved" ||
      template.get("organizationId") !== input.organizationId
    )
      throw new BusinessRuleError(
        "NOTIFICATION_TEMPLATE_NOT_APPROVED",
        "An approved notification template is required.",
      );
    const allowedKeys = Array.isArray(template.get("allowedDataKeys"))
      ? (template.get("allowedDataKeys") as string[])
      : [];
    const data = redactNotificationData(input.data, allowedKeys);
    const preference = await this.db
      .doc(
        `notificationPreferences/${input.recipientUserId}_${input.organizationId}_${input.channel}`,
      )
      .get();
    const suppressed = preference.exists && preference.get("enabled") === false;
    const id = createHash("sha256")
      .update(`${input.organizationId}:${input.idempotencyKey}`)
      .digest("hex");
    const ref = this.db.doc(`notificationOutbox/${id}`);
    try {
      await ref.create({
        ...input,
        data,
        status: suppressed ? "suppressed" : "pending",
        attempts: 0,
        nextAttemptAt: suppressed ? null : FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 6) throw error;
    }
    return { id, status: suppressed ? "suppressed" : "pending" };
  }
  async deliver(
    id: string,
    provider: NotificationProvider,
    now = new Date(),
    maxAttempts = 5,
  ) {
    const ref = this.db.doc(`notificationOutbox/${id}`),
      claim = await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new NotFoundError();
        const status = String(snap.get("status"));
        if (status === "delivered") return null;
        if (status === "suppressed") return null;
        if (status === "dead_letter")
          throw new ConflictError("Notification is in the dead-letter state.");
        if (status === "sending")
          throw new ConflictError(
            "Notification delivery is already in progress.",
          );
        const next = snap.get("nextAttemptAt") as Timestamp | undefined;
        if (next && next.toMillis() > now.getTime())
          throw new ConflictError("Notification is not ready for retry.");
        tx.update(ref, {
          status: "sending",
          updatedAt: FieldValue.serverTimestamp(),
        });
        return snap.data() as Input & { attempts: number };
      });
    if (!claim) return { id, status: "delivered" as const };
    try {
      const result = await provider.send(claim);
      await ref.update({
        status: "delivered",
        providerMessageId: result.providerMessageId,
        deliveredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { id, status: "delivered" as const };
    } catch (error) {
      const attempts = claim.attempts + 1,
        dead = attempts >= maxAttempts;
      await ref.update({
        status: dead ? "dead_letter" : "failed",
        attempts,
        lastErrorCode: error instanceof Error ? error.name : "ProviderError",
        nextAttemptAt: dead
          ? null
          : Timestamp.fromMillis(
              now.getTime() + notificationBackoffMs(attempts),
            ),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        id,
        status: dead ? ("dead_letter" as const) : ("failed" as const),
        attempts,
      };
    }
  }
  async monitoring(p: Principal | undefined, organizationId: string) {
    const actor = this.actor(p);
    if (
      !actor.roles.some((r) => r === "admin" || r === "super_admin") ||
      !actor.organizationIds.includes(organizationId)
    )
      throw new AuthorizationError();
    const snap = await this.db
      .collection("notificationOutbox")
      .where("organizationId", "==", organizationId)
      .get();
    const counts: Record<string, number> = {};
    for (const doc of snap.docs) {
      const status = String(doc.get("status"));
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return { counts, total: snap.size };
  }
}
