import { randomUUID } from "node:crypto";
import type {
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { Principal } from "../auth/authorization.js";
import { requireAdmin } from "../auth/authorization.js";
import { AppError, NotFoundError } from "../shared/errors.js";
import type { z } from "zod";
import type {
  quarterCreateSchema,
  quarterLifecycleSchema,
  quarterListQuerySchema,
  quarterUpdateSchema,
} from "./schemas.js";

type Status = "draft" | "active" | "closed" | "archived";
type ListInput = z.infer<typeof quarterListQuerySchema>;
type CreateInput = z.infer<typeof quarterCreateSchema>;
type UpdateInput = z.infer<typeof quarterUpdateSchema>;
type LifecycleInput = z.infer<typeof quarterLifecycleSchema>;

const quarterError = (status: number, code: string, message: string) =>
  new AppError(status, code, message);
const normalizedName = (name: string) => name.trim().toLocaleLowerCase("en-US");
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  aStart <= bEnd && bStart <= aEnd;
const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toDate" in value) {
    const date = (value as { toDate(): Date }).toDate();
    return date.toISOString();
  }
  throw new Error("Quarter timestamp is missing or invalid.");
};

export class QuarterAdministrationService {
  constructor(private readonly db: Firestore) {}

  private actor(principal: Principal | undefined) {
    return requireAdmin(principal);
  }

  private canAccess(actor: Principal, organizationId: string) {
    return (
      actor.roles.includes("super_admin") ||
      actor.organizationIds.includes(organizationId)
    );
  }

  private scope(actor: Principal, organizationId: string) {
    if (!this.canAccess(actor, organizationId))
      throw quarterError(
        403,
        "QUARTER_SCOPE_FORBIDDEN",
        "Quarter management is not permitted for this organization.",
      );
  }

  private async creationOrganization(
    actor: Principal,
    requestedOrganizationId?: string,
  ) {
    if (requestedOrganizationId) return requestedOrganizationId;
    if (actor.organizationIds.length === 1) return actor.organizationIds[0];

    // A global administrator commonly has no organization membership. Keep
    // organization selection explicit in multi-tenant environments, but avoid
    // making the only tenant in a single-organization deployment redundant
    // client knowledge.
    if (actor.roles.includes("super_admin")) {
      const organizations = await this.db
        .collection("organizations")
        .limit(2)
        .get();
      if (organizations.size === 1) return organizations.docs[0]?.id;
    }

    return undefined;
  }

  private serialize(doc: DocumentSnapshot | QueryDocumentSnapshot) {
    return {
      id: doc.id,
      name: String(doc.get("name")),
      description:
        doc.get("description") == null ? null : String(doc.get("description")),
      startDate: String(doc.get("startDate")),
      endDate: String(doc.get("endDate")),
      status: String(doc.get("status")) as Status,
      organizationId: String(doc.get("organizationId")),
      createdAt: iso(doc.get("createdAt")),
      updatedAt: iso(doc.get("updatedAt")),
      createdBy: String(doc.get("createdBy")),
      updatedBy: String(doc.get("updatedBy")),
      version: Number(doc.get("version")),
    };
  }

  private dateRange(startDate: string, endDate: string) {
    if (startDate > endDate)
      throw quarterError(
        422,
        "QUARTER_DATE_RANGE_INVALID",
        "startDate must be before or equal to endDate.",
      );
  }

  private audit(
    tx: Transaction,
    input: {
      event: string;
      actorId: string;
      targetId: string;
      organizationId: string;
      requestId: string;
      previousVersion: number | null;
      newVersion: number;
      changedFields: readonly string[];
    },
  ) {
    tx.create(this.db.collection("auditLogs").doc(randomUUID()), {
      ...input,
      timestamp: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  async list(principal: Principal | undefined, input: ListInput) {
    const actor = this.actor(principal);
    if (input.organizationId) this.scope(actor, input.organizationId);
    let query = this.db.collection("quarters");
    if (input.organizationId)
      query = query.where(
        "organizationId",
        "==",
        input.organizationId,
      ) as typeof query;
    const docs = (await query.get()).docs.filter((doc) => {
      const organizationId = String(doc.get("organizationId"));
      return (
        this.canAccess(actor, organizationId) &&
        (!input.status || doc.get("status") === input.status) &&
        (!input.search ||
          String(doc.get("name"))
            .toLocaleLowerCase("en-US")
            .includes(input.search.toLocaleLowerCase("en-US")))
      );
    });
    const direction = input.sort.endsWith("desc") ? -1 : 1;
    const field = input.sort.startsWith("start_date")
      ? "startDate"
      : "updatedAt";
    docs.sort((a, b) => {
      const left =
        field === "updatedAt" ? iso(a.get(field)) : String(a.get(field));
      const right =
        field === "updatedAt" ? iso(b.get(field)) : String(b.get(field));
      return direction * left.localeCompare(right) || a.id.localeCompare(b.id);
    });
    const total = docs.length;
    const offset = (input.page - 1) * input.pageSize;
    return {
      items: docs
        .slice(offset, offset + input.pageSize)
        .map((doc) => this.serialize(doc)),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: Math.ceil(total / input.pageSize),
      },
    };
  }

  async get(principal: Principal | undefined, quarterId: string) {
    const actor = this.actor(principal);
    const doc = await this.db.doc(`quarters/${quarterId}`).get();
    if (
      !doc.exists ||
      !this.canAccess(actor, String(doc.get("organizationId")))
    )
      throw new AppError(404, "QUARTER_NOT_FOUND", "Quarter not found.");
    return this.serialize(doc);
  }

  private async unique(
    tx: Transaction,
    organizationId: string,
    name: string,
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
          normalizedName(String(doc.get("name"))) === normalizedName(name),
      )
    )
      throw quarterError(
        409,
        "QUARTER_NAME_CONFLICT",
        "A quarter with this name already exists in the organization.",
      );
  }

  async create(
    principal: Principal | undefined,
    input: CreateInput,
    requestId: string,
  ) {
    const actor = this.actor(principal);
    const organizationId = await this.creationOrganization(
      actor,
      input.organizationId,
    );
    if (!organizationId)
      throw quarterError(
        422,
        "QUARTER_ORGANIZATION_REQUIRED",
        "organizationId is required when the target organization cannot be inferred unambiguously.",
      );
    this.scope(actor, organizationId);
    this.dateRange(input.startDate, input.endDate);
    const ref = this.db.collection("quarters").doc();
    await this.db.runTransaction(async (tx) => {
      const organization = await tx.get(
        this.db.doc(`organizations/${organizationId}`),
      );
      if (!organization.exists)
        throw new NotFoundError("Organization not found.");
      await this.unique(tx, organizationId, input.name);
      tx.create(ref, {
        name: input.name,
        normalizedName: normalizedName(input.name),
        description: input.description ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        status: "draft",
        organizationId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        updatedBy: actor.uid,
        version: 1,
      });
      this.audit(tx, {
        event: "quarter.created",
        actorId: actor.uid,
        targetId: ref.id,
        organizationId,
        requestId,
        previousVersion: null,
        newVersion: 1,
        changedFields: ["name", "description", "startDate", "endDate"],
      });
    });
    return this.get(actor, ref.id);
  }

  async update(
    principal: Principal | undefined,
    quarterId: string,
    input: UpdateInput,
    requestId: string,
  ) {
    const actor = this.actor(principal);
    const ref = this.db.doc(`quarters/${quarterId}`);
    await this.db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (
        !current.exists ||
        !this.canAccess(actor, String(current.get("organizationId")))
      )
        throw quarterError(404, "QUARTER_NOT_FOUND", "Quarter not found.");
      if (current.get("status") !== "draft")
        throw quarterError(
          409,
          "QUARTER_INVALID_TRANSITION",
          "Only draft quarters may be edited.",
        );
      const version = Number(current.get("version"));
      if (version !== input.expectedVersion)
        throw quarterError(
          409,
          "QUARTER_VERSION_CONFLICT",
          "The quarter was changed by another request.",
        );
      const organizationId = String(current.get("organizationId"));
      const name = input.name ?? String(current.get("name"));
      const startDate = input.startDate ?? String(current.get("startDate"));
      const endDate = input.endDate ?? String(current.get("endDate"));
      this.dateRange(startDate, endDate);
      await this.unique(tx, organizationId, name, quarterId);
      const changedFields = Object.keys(input).filter(
        (field) => field !== "expectedVersion",
      );
      tx.update(ref, {
        ...Object.fromEntries(
          changedFields.map((field) => [
            field,
            input[field as keyof UpdateInput],
          ]),
        ),
        ...(input.name ? { normalizedName: normalizedName(input.name) } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        version: version + 1,
      });
      this.audit(tx, {
        event: "quarter.updated",
        actorId: actor.uid,
        targetId: quarterId,
        organizationId,
        requestId,
        previousVersion: version,
        newVersion: version + 1,
        changedFields,
      });
    });
    return this.get(actor, quarterId);
  }

  async transition(
    principal: Principal | undefined,
    quarterId: string,
    input: LifecycleInput,
    to: Exclude<Status, "draft">,
    requestId: string,
  ) {
    const actor = this.actor(principal);
    const ref = this.db.doc(`quarters/${quarterId}`);
    await this.db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (
        !current.exists ||
        !this.canAccess(actor, String(current.get("organizationId")))
      )
        throw quarterError(404, "QUARTER_NOT_FOUND", "Quarter not found.");
      const version = Number(current.get("version"));
      if (version !== input.expectedVersion)
        throw quarterError(
          409,
          "QUARTER_VERSION_CONFLICT",
          "The quarter was changed by another request.",
        );
      const from = String(current.get("status"));
      const expected =
        to === "active" ? "draft" : to === "closed" ? "active" : "closed";
      if (from !== expected)
        throw quarterError(
          409,
          "QUARTER_INVALID_TRANSITION",
          `A quarter cannot transition from ${from} to ${to}.`,
        );
      const organizationId = String(current.get("organizationId"));
      if (to === "active") {
        const active = await tx.get(
          this.db
            .collection("quarters")
            .where("organizationId", "==", organizationId)
            .where("status", "==", "active"),
        );
        if (
          active.docs.some(
            (doc) =>
              doc.id !== quarterId &&
              overlaps(
                String(current.get("startDate")),
                String(current.get("endDate")),
                String(doc.get("startDate")),
                String(doc.get("endDate")),
              ),
          )
        )
          throw quarterError(
            409,
            "QUARTER_OVERLAP",
            "An active quarter already overlaps this date range.",
          );
      }
      tx.update(ref, {
        status: to,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        version: version + 1,
      });
      this.audit(tx, {
        event: `quarter.${to === "active" ? "activated" : to}`,
        actorId: actor.uid,
        targetId: quarterId,
        organizationId,
        requestId,
        previousVersion: version,
        newVersion: version + 1,
        changedFields: ["status"],
      });
    });
    return this.get(actor, quarterId);
  }
}
