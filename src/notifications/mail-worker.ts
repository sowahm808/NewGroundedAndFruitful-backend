import type {
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";

type Invitation = {
  to?: unknown;
  template?: unknown;
  status?: unknown;
  joinUrl?: unknown;
  organizationName?: unknown;
  participantName?: unknown;
  data?: {
    joinUrl?: unknown;
    organizationName?: unknown;
    participantName?: unknown;
  };
};

/**
 * Starts the durable mail-queue consumer used by the API deployment. Firestore
 * redeliveries are made safe by transactionally claiming each queued document.
 */
export function startMailWorker(db: Firestore): () => void {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    logger.warn("mail_worker_disabled", {
      reason: "mail_provider_not_configured",
    });
    return () => undefined;
  }
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM;
  const unsubscribe = db
    .collection("mailQueue")
    .where("template", "==", "guardian_invitation")
    .onSnapshot(
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type !== "removed")
            void deliver(db, change.doc, apiKey, from);
        }
      },
      (error) =>
        logger.error("mail_worker_snapshot_failed", { errorType: error.name }),
    );
  return unsubscribe;
}

async function deliver(
  db: Firestore,
  document: QueryDocumentSnapshot,
  apiKey: string,
  from: string,
): Promise<void> {
  const claimed = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(document.ref);
    if (!current.exists || current.get("status") !== "queued") return false;
    transaction.update(document.ref, {
      status: "sending",
      attemptStartedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!claimed) return;
  const invitation = document.data() as Invitation;
  const to = typeof invitation.to === "string" ? invitation.to : "";
  const joinUrl = text(invitation.joinUrl ?? invitation.data?.joinUrl, "");
  const organizationName = text(
    invitation.organizationName ?? invitation.data?.organizationName,
    "Grounded & Fruitful",
  );
  const participantName = text(
    invitation.participantName ?? invitation.data?.participantName,
    "your participant",
  );
  try {
    if (!to || !joinUrl) throw new Error("invalid_guardian_invitation_payload");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `You are invited to join ${organizationName}`,
        html: `<p>You have been invited to support ${escapeHtml(participantName)} at ${escapeHtml(organizationName)}.</p><p><a href="${escapeHtml(joinUrl)}">Join as guardian</a></p>`,
      }),
    });
    if (!response.ok)
      throw new Error(`mail_provider_${String(response.status)}`);
    await document.ref.update({
      status: "delivered",
      sentAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    await document.ref.update({
      status: "failed",
      failedAt: FieldValue.serverTimestamp(),
      error:
        error instanceof Error
          ? error.message.slice(0, 160)
          : "mail_delivery_failed",
    });
    logger.error("guardian_invitation_delivery_failed", {
      queueId: document.id,
    });
  }
}

const text = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
