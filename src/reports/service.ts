import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash, randomUUID } from "node:crypto";
import type { Principal } from "../auth/authorization.js";
import {
  requireAuthenticated,
  requireCapability,
  requireParentOf,
} from "../auth/authorization.js";
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from "../shared/errors.js";

type RequestInput = {
  organizationId: string;
  participantId: string;
  reportType: string;
  policyVersion: string;
  idempotencyKey: string;
};
export interface ReportRenderer {
  render(input: {
    organizationId: string;
    participantId: string;
    reportType: string;
    redactionProfile: string;
  }): Promise<Buffer>;
}
interface ReportBucket {
  file(path: string): {
    save(
      data: Buffer,
      options: {
        contentType: string;
        resumable: boolean;
        metadata: { cacheControl: string };
      },
    ): Promise<unknown>;
    getSignedUrl(options: {
      action: "read";
      expires: number;
    }): Promise<[string, ...unknown[]]>;
  };
}
export class ReportService {
  constructor(
    private db: Firestore,
    private bucket?: ReportBucket,
  ) {}
  private admin(
    p: Principal | undefined,
    organizationId: string,
    capability: string,
  ) {
    const actor = requireCapability(p, capability);
    const membership = actor.memberships?.find(
      (item) =>
        item.userId === actor.uid && item.organizationId === organizationId,
    );
    if (
      !membership ||
      actor.activeWorkspaceId !==
        (membership.workspaceId ?? membership.organizationId)
    )
      throw new AuthorizationError();
    return actor;
  }
  private value(value: unknown): number | string {
    if (value && typeof value === "object" && "toMillis" in value)
      return (value as { toMillis(): number }).toMillis();
    return typeof value === "string" ? value.toLowerCase() : 0;
  }
  private async listCollection(
    collection: "reportPolicies" | "reportJobs",
    organizationId: string,
    page: number,
    pageSize: number,
    sort: string,
    status?: string,
  ) {
    const snapshot = await this.db
      .collection(collection)
      .where("organizationId", "==", organizationId)
      .get();
    const field = sort.replace("-", ""),
      direction = sort.startsWith("-") ? -1 : 1;
    const all = snapshot.docs
      .map<Record<string, unknown> & { id: string }>((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .filter((item) => !status || item.status === status)
      .sort(
        (a, b) =>
          direction *
          (this.value(a[field]) < this.value(b[field])
            ? -1
            : this.value(a[field]) > this.value(b[field])
              ? 1
              : a.id.localeCompare(b.id)),
      );
    return {
      items: all.slice((page - 1) * pageSize, page * pageSize),
      pagination: {
        page,
        pageSize,
        total: all.length,
        totalPages: Math.ceil(all.length / pageSize),
      },
    };
  }
  async definitions(
    p: Principal | undefined,
    query: {
      organizationId: string;
      page: number;
      pageSize: number;
      sort: string;
      status?: string | undefined;
    },
  ) {
    this.admin(p, query.organizationId, "admin.reports.read");
    return this.listCollection(
      "reportPolicies",
      query.organizationId,
      query.page,
      query.pageSize,
      query.sort,
      query.status,
    );
  }
  async jobs(
    p: Principal | undefined,
    query: {
      organizationId: string;
      page: number;
      pageSize: number;
      sort: string;
      status?: string | undefined;
    },
  ) {
    this.admin(p, query.organizationId, "admin.reports.read");
    return this.listCollection(
      "reportJobs",
      query.organizationId,
      query.page,
      query.pageSize,
      query.sort,
      query.status,
    );
  }
  private async scope(
    p: Principal | undefined,
    input: Pick<RequestInput, "organizationId" | "participantId">,
  ) {
    const actor = requireAuthenticated(p);
    if (!actor.organizationIds.includes(input.organizationId))
      throw new AuthorizationError();
    const participant = await this.db
      .doc(`participants/${input.participantId}`)
      .get();
    if (
      !participant.exists ||
      participant.get("organizationId") !== input.organizationId
    )
      throw new AuthorizationError();
    if (actor.roles.includes("parent"))
      await requireParentOf(this.db, actor, input.participantId);
    else if (!actor.roles.some((r) => r === "admin" || r === "super_admin"))
      throw new AuthorizationError();
    return actor;
  }
  async request(p: Principal | undefined, input: RequestInput) {
    if (p?.roles.some((role) => role === "admin" || role === "super_admin"))
      this.admin(p, input.organizationId, "admin.reports.manage");
    const actor = await this.scope(p, input);
    const policy = await this.db
      .doc(`reportPolicies/${input.reportType}_${input.policyVersion}`)
      .get();
    if (
      !policy.exists ||
      policy.get("status") !== "approved" ||
      policy.get("organizationId") !== input.organizationId
    )
      throw new BusinessRuleError(
        "REPORT_POLICY_NOT_APPROVED",
        "An approved report redaction and expiry policy is required.",
      );
    const expirySeconds = Number(policy.get("storageExpirySeconds"));
    if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= 0)
      throw new BusinessRuleError(
        "REPORT_POLICY_INCOMPLETE",
        "The approved report policy does not define storage expiry.",
      );
    const id = createHash("sha256")
        .update(`${input.organizationId}:${actor.uid}:${input.idempotencyKey}`)
        .digest("hex"),
      ref = this.db.doc(`reportJobs/${id}`);
    try {
      await ref.create({
        ...input,
        requestedBy: actor.uid,
        status: "queued",
        redactionProfile: String(policy.get("redactionProfile")),
        storageExpirySeconds: expirySeconds,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 6) throw error;
    }
    return { id, status: "queued" };
  }
  async cancel(p: Principal | undefined, id: string, organizationId: string) {
    this.admin(p, organizationId, "admin.reports.manage");
    const ref = this.db.doc(`reportJobs/${id}`),
      snap = await ref.get();
    if (!snap.exists || snap.get("organizationId") !== organizationId)
      throw new NotFoundError();
    if (!["queued", "generating"].includes(String(snap.get("status"))))
      throw new ConflictError(
        "Only queued or generating reports can be cancelled.",
      );
    await ref.update({
      status: "cancelled",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { id, status: "cancelled" as const };
  }
  async retry(p: Principal | undefined, id: string, organizationId: string) {
    this.admin(p, organizationId, "admin.reports.manage");
    const ref = this.db.doc(`reportJobs/${id}`),
      snap = await ref.get();
    if (!snap.exists || snap.get("organizationId") !== organizationId)
      throw new NotFoundError();
    if (snap.get("status") !== "failed")
      throw new ConflictError("Only failed reports can be retried.");
    await ref.update({
      status: "queued",
      failureCode: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { id, status: "queued" as const };
  }
  async status(p: Principal | undefined, id: string) {
    const snap = await this.db.doc(`reportJobs/${id}`).get();
    if (!snap.exists) throw new NotFoundError();
    const scope = {
      organizationId: String(snap.get("organizationId")),
      participantId: String(snap.get("participantId")),
    };
    if (p?.roles.some((role) => role === "admin" || role === "super_admin"))
      this.admin(p, scope.organizationId, "admin.reports.read");
    else await this.scope(p, scope);
    return {
      id,
      status: snap.get("status"),
      expiresAt: snap.get("expiresAt") ?? null,
      failureCode: snap.get("failureCode") ?? null,
    };
  }
  async generate(id: string, renderer: ReportRenderer, now = new Date()) {
    if (!this.bucket) throw new Error("Report storage is not configured.");
    const ref = this.db.doc(`reportJobs/${id}`),
      snap = await ref.get();
    if (!snap.exists) throw new NotFoundError();
    if (snap.get("status") === "ready") return { id, status: "ready" as const };
    if (snap.get("status") !== "queued") throw new ConflictError();
    await ref.update({
      status: "generating",
      updatedAt: FieldValue.serverTimestamp(),
    });
    try {
      const bytes = await renderer.render({
        organizationId: String(snap.get("organizationId")),
        participantId: String(snap.get("participantId")),
        reportType: String(snap.get("reportType")),
        redactionProfile: String(snap.get("redactionProfile")),
      });
      const objectPath = `private-reports/${String(snap.get("organizationId"))}/${id}`;
      await this.bucket.file(objectPath).save(bytes, {
        contentType: "application/pdf",
        resumable: false,
        metadata: { cacheControl: "private,no-store" },
      });
      const expiresAt = Timestamp.fromMillis(
        now.getTime() + Number(snap.get("storageExpirySeconds")) * 1000,
      );
      await ref.update({
        status: "ready",
        objectPath,
        expiresAt,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { id, status: "ready" as const, expiresAt };
    } catch (error) {
      await ref.update({
        status: "failed",
        failureCode: error instanceof Error ? error.name : "RenderError",
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw error;
    }
  }
  async download(p: Principal | undefined, id: string, now = new Date()) {
    if (!this.bucket)
      throw new BusinessRuleError(
        "REPORT_STORAGE_UNAVAILABLE",
        "Report storage is unavailable.",
      );
    const ref = this.db.doc(`reportJobs/${id}`),
      snap = await ref.get();
    if (!snap.exists) throw new NotFoundError();
    const scope = {
      organizationId: String(snap.get("organizationId")),
      participantId: String(snap.get("participantId")),
    };
    const actor = p?.roles.some(
      (role) => role === "admin" || role === "super_admin",
    )
      ? this.admin(p, scope.organizationId, "admin.reports.read")
      : await this.scope(p, scope);
    const expires = snap.get("expiresAt") as Timestamp | undefined;
    if (
      snap.get("status") !== "ready" ||
      !expires ||
      expires.toMillis() <= now.getTime()
    )
      throw new ConflictError("Report is not available for download.");
    const urlExpiry = Math.min(expires.toMillis(), now.getTime() + 5 * 60_000);
    const [url] = await this.bucket
      .file(String(snap.get("objectPath")))
      .getSignedUrl({ action: "read", expires: urlExpiry });
    await this.db
      .collection("auditLogs")
      .doc(randomUUID())
      .create({
        event: "report.downloaded",
        actorId: actor.uid,
        organizationId: snap.get("organizationId"),
        subject: { reportJobId: id, participantId: snap.get("participantId") },
        createdAt: FieldValue.serverTimestamp(),
      });
    return { url, expiresAt: new Date(urlExpiry).toISOString() };
  }
}
