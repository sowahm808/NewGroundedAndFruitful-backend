import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Principal } from "../auth/authorization.js";
import { requireAuthenticated } from "../auth/authorization.js";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "../shared/errors.js";
import {
  assertDateRange,
  assertQuarterTransition,
  localEndExclusive,
  localMidnight,
  quarterOccupiesCalendar,
  rangesOverlap,
  type QuarterState,
} from "./domain.js";

type Input = Record<string, unknown>;
const string = (value: unknown) => String(value);

export class ConfigurationService {
  constructor(private readonly db: Firestore) {}

  private admin(principal: Principal | undefined, organizationId: string) {
    const actor = requireAuthenticated(principal);
    if (
      !actor.organizationIds.includes(organizationId) ||
      !actor.roles.some((r) => r === "admin" || r === "super_admin")
    )
      throw new AuthorizationError();
    return actor;
  }

  private audit(
    tx: Transaction,
    actorId: string,
    organizationId: string,
    event: string,
    subject: Input,
  ) {
    tx.create(this.db.collection("auditLogs").doc(randomUUID()), {
      actorId,
      organizationId,
      event,
      subject,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  private async context(
    tx: Transaction,
    organizationId: string,
    quarterId?: string,
  ) {
    const organization = await tx.get(
      this.db.doc(`organizations/${organizationId}`),
    );
    if (!organization.exists)
      throw new NotFoundError("Organization not found.");
    const timezone = string(organization.get("timezone"));
    // Validation is intentional here too: legacy documents may predate request validation.
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    } catch {
      throw new ConflictError("The organization timezone is invalid.");
    }
    if (!quarterId) return { timezone, quarter: undefined };
    const quarter = await tx.get(this.db.doc(`quarters/${quarterId}`));
    if (!quarter.exists || quarter.get("organizationId") !== organizationId)
      throw new NotFoundError("Quarter not found.");
    return { timezone, quarter };
  }

  private async assertNoOverlap(
    tx: Transaction,
    organizationId: string,
    startDate: string,
    endDate: string,
    exceptId?: string,
  ) {
    const snapshot = await tx.get(
      this.db
        .collection("quarters")
        .where("organizationId", "==", organizationId),
    );
    if (
      snapshot.docs.some(
        (doc) =>
          doc.id !== exceptId &&
          quarterOccupiesCalendar(doc.get("state") as QuarterState) &&
          rangesOverlap(
            startDate,
            endDate,
            string(doc.get("startDate")),
            string(doc.get("endDate")),
          ),
      )
    )
      throw new ConflictError(
        "This quarter overlaps another active or scheduled quarter in the organization.",
      );
  }

  async createQuarter(principal: Principal | undefined, input: Input) {
    const organizationId = string(input.organizationId),
      actor = this.admin(principal, organizationId);
    const startDate = string(input.startDate),
      endDate = string(input.endDate);
    assertDateRange(startDate, endDate, "Quarter");
    const ref = this.db.collection("quarters").doc();
    await this.db.runTransaction(async (tx) => {
      const { timezone } = await this.context(tx, organizationId);
      const program = await tx.get(
        this.db.doc(`programs/${string(input.programId)}`),
      );
      if (!program.exists || program.get("organizationId") !== organizationId)
        throw new NotFoundError("Program not found.");
      tx.create(ref, {
        ...input,
        timezone,
        state: "draft",
        status: "draft",
        version: 1,
        startsAt: Timestamp.fromDate(localMidnight(startDate, timezone)),
        endsAt: Timestamp.fromDate(localEndExclusive(endDate, timezone)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, organizationId, "quarter.created", {
        quarterId: ref.id,
      });
    });
    return { id: ref.id, state: "draft", version: 1 };
  }

  async transitionQuarter(
    principal: Principal | undefined,
    quarterId: string,
    input: Input,
  ) {
    const ref = this.db.doc(`quarters/${quarterId}`);
    return this.db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (!current.exists) throw new NotFoundError();
      const organizationId = string(current.get("organizationId")),
        actor = this.admin(principal, organizationId);
      const from = string(
        current.get("state") ?? current.get("status"),
      ) as QuarterState;
      const to = string(input.state) as QuarterState;
      assertQuarterTransition(from, to);
      const version = Number(current.get("version") ?? 1);
      if (version !== Number(input.version))
        throw new ConflictError("Quarter version is stale.");
      await this.context(tx, organizationId);
      if (quarterOccupiesCalendar(to))
        await this.assertNoOverlap(
          tx,
          organizationId,
          string(current.get("startDate")),
          string(current.get("endDate")),
          quarterId,
        );
      tx.update(ref, {
        state: to,
        status: to,
        version: version + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, organizationId, "quarter.transitioned", {
        quarterId,
        from,
        to,
        version: version + 1,
      });
      return { id: quarterId, state: to, version: version + 1 };
    });
  }

  async createCharacterCycle(principal: Principal | undefined, input: Input) {
    const organizationId = string(input.organizationId),
      actor = this.admin(principal, organizationId);
    const startDate = string(input.startDate),
      endDate = string(input.endDate),
      qualityIds = input.qualityIds as string[];
    assertDateRange(startDate, endDate, "Character cycle");
    const ref = this.db.collection("characterCycles").doc();
    await this.db.runTransaction(async (tx) => {
      const { timezone, quarter } = await this.context(
        tx,
        organizationId,
        string(input.quarterId),
      );
      if (
        startDate < string(quarter!.get("startDate")) ||
        endDate > string(quarter!.get("endDate"))
      )
        throw new ConflictError(
          "The character cycle must be contained within its quarter.",
        );
      const qualities = await Promise.all(
        qualityIds.map((id) => tx.get(this.db.doc(`characterQualities/${id}`))),
      );
      if (
        qualities.some(
          (q) =>
            !q.exists ||
            q.get("organizationId") !== organizationId ||
            q.get("status") !== "active",
        )
      )
        throw new ConflictError(
          "Every selected character quality must be active in this organization.",
        );
      tx.create(ref, {
        ...input,
        timezone,
        status: "active",
        version: 1,
        startsAt: Timestamp.fromDate(localMidnight(startDate, timezone)),
        endsAt: Timestamp.fromDate(localEndExclusive(endDate, timezone)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, organizationId, "character_cycle.created", {
        cycleId: ref.id,
        quarterId: input.quarterId,
      });
    });
    return { id: ref.id, version: 1 };
  }

  async createContentAssignment(
    principal: Principal | undefined,
    input: Input,
  ) {
    return this.createBoundedVersioned(
      principal,
      "contentAssignments",
      "content_assignment.created",
      input,
      false,
    );
  }

  async createPointRuleVersion(principal: Principal | undefined, input: Input) {
    return this.createBoundedVersioned(
      principal,
      "pointRules",
      "point_rule_version.created",
      input,
      true,
    );
  }

  private async createBoundedVersioned(
    principal: Principal | undefined,
    collection: string,
    event: string,
    input: Input,
    versionRule: boolean,
  ) {
    const organizationId = string(input.organizationId),
      actor = this.admin(principal, organizationId);
    const startDate = string(
      versionRule ? input.effectiveStartDate : input.startDate,
    );
    const endDate = string(
      versionRule ? input.effectiveEndDate : input.endDate,
    );
    assertDateRange(
      startDate,
      endDate,
      versionRule ? "Point rule" : "Content assignment",
    );
    const ref = this.db.collection(collection).doc();
    let version = 1;
    await this.db.runTransaction(async (tx) => {
      const { timezone, quarter } = await this.context(
        tx,
        organizationId,
        string(input.quarterId),
      );
      if (
        startDate < string(quarter!.get("startDate")) ||
        endDate > string(quarter!.get("endDate"))
      )
        throw new ConflictError(
          "Configuration dates must be contained within the quarter.",
        );
      if (versionRule) {
        const existing = await tx.get(
          this.db
            .collection("pointRules")
            .where("organizationId", "==", organizationId)
            .where("quarterId", "==", input.quarterId)
            .where("sourceType", "==", input.sourceType),
        );
        version = existing.size + 1;
      }
      tx.create(ref, {
        ...input,
        timezone,
        status: "active",
        version,
        effectiveFrom: Timestamp.fromDate(localMidnight(startDate, timezone)),
        effectiveUntil: Timestamp.fromDate(localEndExclusive(endDate, timezone)),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, actor.uid, organizationId, event, {
        id: ref.id,
        quarterId: input.quarterId,
        version,
      });
    });
    return { id: ref.id, version };
  }
}
