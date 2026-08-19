import type { Firestore, Timestamp } from "firebase-admin/firestore";
import type { Principal } from "../auth/authorization.js";
import { requireRole } from "../auth/authorization.js";
import { AuthorizationError, ConflictError } from "../shared/errors.js";

export interface ChildContext { actorUid: string; participantId: string; organizationId: string; teamId: string | null; activeQuarterId: string | null; timezone: string }
export interface ActiveQuarter { id: string; name: string; status: string; timezone: string; startsAt: Timestamp; endsAt: Timestamp; targetPoints: number }

export const localDateIn = (date: Date, timezone: string): string => {
  try { const parts=Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map(part=>[part.type,part.value])); return [parts.year,parts.month,parts.day].join("-"); }
  catch { throw new ConflictError("The organization timezone is invalid."); }
};

export async function resolveActiveQuarter(db: Firestore, organizationId: string, now = new Date()): Promise<ActiveQuarter | null> {
  const snap = await db.collection("quarters").where("organizationId", "==", organizationId).get();
  const active = snap.docs.filter((doc) => {
    const d = doc.data(); const start = d.startsAt as Timestamp | undefined; const end = d.endsAt as Timestamp | undefined;
    return start && end && ["open", "checkpoint", "recognition"].includes(String(d.status)) && start.toMillis() <= now.getTime() && end.toMillis() >= now.getTime();
  });
  if (active.length > 1) throw new ConflictError("Multiple active quarters are configured.");
  if (!active[0]) return null;
  const d = active[0].data();
  return { id: active[0].id, name: String(d.name), status: String(d.status), timezone: String(d.timezone), startsAt: d.startsAt as Timestamp, endsAt: d.endsAt as Timestamp, targetPoints: Number(d.targetPoints ?? 0) };
}

export async function resolveChildContext(db: Firestore, principal: Principal | undefined, now = new Date()): Promise<{ context: ChildContext; participant: FirebaseFirestore.DocumentSnapshot; quarter: ActiveQuarter | null }> {
  const actor = requireRole(principal, "child");
  const memberships = await db.collection("memberships").where("userId", "==", actor.uid).get();
  const valid = memberships.docs.filter((m) => m.get("status") === "active" && Array.isArray(m.get("roles")) && (m.get("roles") as unknown[]).includes("child"));
  if (valid.length !== 1) throw new AuthorizationError();
  const organizationId = valid[0]!.get("organizationId") as string;
  const participants = await db.collection("participants").where("firebaseUid", "==", actor.uid).get();
  const owned = participants.docs.filter((p) => p.get("organizationId") === organizationId && p.get("status") !== "inactive");
  if (owned.length !== 1 || !actor.organizationIds.includes(organizationId)) throw new AuthorizationError();
  const quarter = await resolveActiveQuarter(db, organizationId, now);
  const timezone = quarter?.timezone ?? String(valid[0]!.get("timezone") ?? owned[0]!.get("timezone") ?? "UTC");
  localDateIn(now, timezone);
  return { context: { actorUid: actor.uid, participantId: owned[0]!.id, organizationId, teamId: (owned[0]!.get("activeTeamId") as string | undefined) ?? null, activeQuarterId: quarter?.id ?? null, timezone }, participant: owned[0]!, quarter };
}
