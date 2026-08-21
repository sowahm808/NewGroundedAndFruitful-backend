/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-condition */
import { randomUUID } from "node:crypto";
import {
  FieldValue,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import type { Principal } from "../auth/authorization.js";
import { requireAdmin } from "../auth/authorization.js";
import {
  AppError,
  AuthorizationError,
  ServiceUnavailableError,
  ValidationError,
} from "../shared/errors.js";
import { parseBibleDocxPair } from "./docx.js";
import type { BiblePreviewItem } from "./domain.js";
import { logger } from "../shared/logger.js";

const error = (status: number, code: string, message: string) =>
  new AppError(status, code, message);
const iso = (v: unknown) =>
  v && typeof v === "object" && "toDate" in v
    ? (v as { toDate(): Date }).toDate().toISOString()
    : (v ?? null);
const safeName = (name: string) =>
  name
    .normalize("NFKC")
    .replace(/[/\\]/g, "_")
    .split("")
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ? "_"
        : character,
    )
    .join("")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120) || "document.docx";
interface ImportStorage {
  file(path: string): {
    save(data: Buffer, options: Record<string, unknown>): Promise<unknown>;
    delete(options?: Record<string, unknown>): Promise<unknown>;
  };
}
export interface Upload {
  name: string;
  mime: string;
  buffer: Buffer;
}
export class BibleAdministrationService {
  constructor(
    private readonly db: Firestore,
    private readonly bucket?: ImportStorage,
  ) {}
  private actor(principal: Principal | undefined, organizationId?: string) {
    const actor = requireAdmin(principal);
    if (
      organizationId &&
      !actor.roles.includes("super_admin") &&
      !actor.organizationIds.includes(organizationId)
    )
      throw error(404, "BIBLE_SCOPE_FORBIDDEN", "Bible resource not found.");
    return actor;
  }
  private audit(
    tx: Transaction,
    event: string,
    actorId: string,
    organizationId: string,
    targetId: string,
    requestId: string,
    metadata: Record<string, unknown>,
  ) {
    tx.create(this.db.collection("auditLogs").doc(randomUUID()), {
      event,
      actorId,
      organizationId,
      targetId,
      requestId,
      metadata,
      timestamp: FieldValue.serverTimestamp(),
    });
  }
  private async scoped(
    id: string,
    principal: Principal | undefined,
    collection = "bibleImports",
  ) {
    const doc = await this.db.doc(`${collection}/${id}`).get();
    if (!doc.exists)
      throw error(404, "BIBLE_CONTENT_NOT_FOUND", "Bible resource not found.");
    this.actor(principal, String(doc.get("organizationId")));
    return doc;
  }
  async create(
    principal: Principal | undefined,
    metadata: { organizationId: string; quarterId: string; title: string },
    quiz: Upload,
    key: Upload,
    requestId: string,
  ) {
    const startedAt = Date.now();
    const phase = (event: string, fields: Record<string, unknown> = {}) =>
      logger.info(`bible_import.${event}`, {
        requestId,
        actorId: principal?.uid,
        organizationId: metadata.organizationId,
        quarterId: metadata.quarterId,
        durationMs: Date.now() - startedAt,
        ...fields,
      });
    phase("request_received", {
      quizFileSize: quiz.buffer.length,
      answerKeyFileSize: key.buffer.length,
    });
    const actor = requireAdmin(principal);
    if (
      !actor.roles.includes("super_admin") &&
      !actor.organizationIds.includes(metadata.organizationId)
    )
      throw new AuthorizationError();
    phase("authorization_passed");
    const fileErrors: Record<string, string[]> = {};
    for (const [field, file] of [
      ["quizFile", quiz],
      ["answerKeyFile", key],
    ] as const) {
      const errors: string[] = [];
      if (!file.name.toLowerCase().endsWith(".docx"))
        errors.push("File extension must be .docx.");
      if (
        file.mime !==
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
        errors.push("File MIME type must be the DOCX media type.");
      if (file.buffer.length > 5 * 1024 * 1024)
        errors.push("File must not exceed 5 MiB.");
      if (
        file.buffer.length < 4 ||
        file.buffer[0] !== 0x50 ||
        file.buffer[1] !== 0x4b ||
        ![0x03, 0x05, 0x07].includes(file.buffer[2]!) ||
        ![0x04, 0x06, 0x08].includes(file.buffer[3]!)
      )
        errors.push("File signature is not a ZIP-based DOCX package.");
      if (errors.length) fileErrors[field] = errors;
    }
    if (Object.keys(fileErrors).length)
      throw new ValidationError("Invalid Bible import fields.", {
        fieldErrors: fileErrors,
      });
    phase("documents_validated");
    const [org, quarter] = await Promise.all([
      this.db.doc(`organizations/${metadata.organizationId}`).get(),
      this.db.doc(`quarters/${metadata.quarterId}`).get(),
    ]);
    if (!org.exists)
      throw new ValidationError("Invalid Bible import fields.", {
        fieldErrors: { organizationId: ["Organization does not exist."] },
      });
    if (!quarter.exists)
      throw error(404, "BIBLE_QUARTER_NOT_FOUND", "Quarter not found.");
    if (quarter.get("organizationId") !== metadata.organizationId)
      throw new AuthorizationError();
    const quarterStatus = quarter.get("status");
    if (quarterStatus && !["draft", "active"].includes(String(quarterStatus)))
      throw error(
        409,
        "BIBLE_QUARTER_LIFECYCLE_CONFLICT",
        "The selected quarter does not allow imports.",
      );
    const startDate = String(quarter.get("startDate")),
      endDate = String(quarter.get("endDate"));
    const result = parseBibleDocxPair(quiz.buffer, key.buffer, {
      startDate,
      endDate,
    });
    phase("question_parse_completed", { activityCount: result.items.length });
    phase("answer_parse_completed");
    if (result.errors.length)
      throw new AppError(
        422,
        "QUIZ_DOCUMENT_RECONCILIATION_FAILED",
        "The question and answer documents could not be reconciled.",
        {
          fieldErrors: {
            answerKeyFile: result.errors.slice(0, 50),
          },
          details: result.diagnostics,
        },
      );
    phase("reconciliation_completed", { activityCount: result.items.length });
    if (!this.bucket)
      throw new ServiceUnavailableError("Bible import storage is unavailable.");
    const ref = this.db.collection("bibleImports").doc(),
      objectPrefix = `bible-imports/${ref.id}`,
      quizPath = `${objectPrefix}/${randomUUID()}.docx`,
      keyPath = `${objectPrefix}/${randomUUID()}.docx`,
      stored: string[] = [];
    try {
      for (const [path, file] of [
        [quizPath, quiz],
        [keyPath, key],
      ] as const) {
        await this.bucket.file(path).save(file.buffer, {
          resumable: false,
          contentType: file.mime,
          metadata: { cacheControl: "private, no-store" },
        });
        stored.push(path);
      }
      phase("storage_completed", {
        importId: ref.id,
        objectCount: stored.length,
      });
      await this.db.runTransaction(async (tx) => {
        const duplicate = await tx.get(
          this.db
            .collection("bibleImports")
            .where("requestId", "==", requestId),
        );
        if (!duplicate.empty)
          throw error(
            409,
            "BIBLE_IMPORT_IDEMPOTENCY_CONFLICT",
            "An import already exists for this request ID.",
          );
        tx.create(ref, {
          organizationId: metadata.organizationId,
          quarterId: metadata.quarterId,
          title: metadata.title,
          status: "needs_review",
          timezone: String(org.get("timezone") ?? "UTC"),
          quizFile: {
            displayName: safeName(quiz.name),
            size: quiz.buffer.length,
            storagePath: quizPath,
          },
          answerKeyFile: {
            displayName: safeName(key.name),
            size: key.buffer.length,
            storagePath: keyPath,
          },
          requestId,
          sourceChecksums: result.checksums,
          parserVersion: result.parserVersion,
          items: result.items,
          warnings: result.warnings,
          errors: result.errors,
          validationSummary: {
            activityCount: result.items.length,
            errorCount: result.errors.length,
            warningCount: result.warnings.length,
          },
          version: 1,
          createdBy: actor.uid,
          updatedBy: actor.uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        this.audit(
          tx,
          "bible.import.created",
          actor.uid,
          metadata.organizationId,
          ref.id,
          requestId,
          { status: "needs_review", version: 1 },
        );
        this.audit(
          tx,
          "bible.import.parsed",
          actor.uid,
          metadata.organizationId,
          ref.id,
          requestId,
          {
            activityCount: result.items.length,
            errorCount: result.errors.length,
            warningCount: result.warnings.length,
            parserVersion: result.parserVersion,
          },
        );
      });
      phase("persistence_completed", { importId: ref.id });
    } catch (cause) {
      await Promise.allSettled(
        stored.map((path) =>
          this.bucket!.file(path).delete({ ignoreNotFound: true }),
        ),
      );
      if (cause instanceof AppError) throw cause;
      logger.error("bible_import.failed", {
        requestId,
        actorId: actor.uid,
        organizationId: metadata.organizationId,
        quarterId: metadata.quarterId,
        importId: ref.id,
        phase: stored.length < 2 ? "storage" : "persistence",
        durationMs: Date.now() - startedAt,
        errorType: cause instanceof Error ? cause.name : "unknown",
        safeErrorCode:
          stored.length < 2
            ? "BIBLE_IMPORT_STORAGE_UNAVAILABLE"
            : "BIBLE_IMPORT_PERSISTENCE_FAILED",
      });
      throw error(
        stored.length < 2 ? 503 : 500,
        stored.length < 2
          ? "BIBLE_IMPORT_STORAGE_UNAVAILABLE"
          : "BIBLE_IMPORT_PERSISTENCE_FAILED",
        stored.length < 2
          ? "Bible import storage is temporarily unavailable."
          : "Bible import persistence failed.",
      );
    }
    return this.get(principal, ref.id);
  }
  async get(principal: Principal | undefined, id: string) {
    const d = await this.scoped(id, principal);
    return {
      id: d.id,
      organizationId: d.get("organizationId"),
      quarterId: d.get("quarterId"),
      title: d.get("title"),
      status: d.get("status"),
      quizFile: d.get("quizFile"),
      answerKeyFile: d.get("answerKeyFile"),
      sourceChecksums: d.get("sourceChecksums"),
      parserVersion: d.get("parserVersion"),
      items: d.get("items") ?? [],
      warnings: d.get("warnings") ?? [],
      errors: d.get("errors") ?? [],
      validationSummary: d.get("validationSummary"),
      version: d.get("version"),
      committedContentSetId: d.get("committedContentSetId") ?? null,
      createdAt: iso(d.get("createdAt")),
      updatedAt: iso(d.get("updatedAt")),
    };
  }
  async patchItem(
    principal: Principal | undefined,
    importId: string,
    itemId: string,
    input: {
      expectedVersion: number;
      title?: string;
      scriptureReference?: string;
      questions?: BiblePreviewItem["questions"];
    },
    requestId: string,
  ) {
    const old = await this.scoped(importId, principal),
      actor = this.actor(principal, String(old.get("organizationId")));
    await this.db.runTransaction(async (tx) => {
      const d = await tx.get(old.ref);
      const changes = {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.scriptureReference === undefined
          ? {}
          : { scriptureReference: input.scriptureReference }),
        ...(input.questions === undefined
          ? {}
          : { questions: input.questions }),
      };
      const items = (d.get("items") as BiblePreviewItem[]).map((item) =>
          item.id === itemId
            ? {
                ...item,
                ...changes,
                version: item.version + 1,
              }
            : item,
        ),
        found = (d.get("items") as BiblePreviewItem[]).find(
          (item) => item.id === itemId,
        );
      if (!found)
        throw error(404, "BIBLE_CONTENT_NOT_FOUND", "Preview item not found.");
      if (found.version !== input.expectedVersion)
        throw error(
          409,
          "BIBLE_IMPORT_VERSION_CONFLICT",
          "Preview item version changed.",
        );
      tx.update(old.ref, {
        items,
        version: Number(d.get("version")) + 1,
        status: "needs_review",
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(
        tx,
        "bible.import.corrected",
        actor.uid,
        String(d.get("organizationId")),
        importId,
        requestId,
        { itemId, newVersion: found.version + 1 },
      );
    });
    return this.get(principal, importId);
  }
  async validate(
    principal: Principal | undefined,
    id: string,
    requestId: string,
  ) {
    const old = await this.scoped(id, principal),
      actor = this.actor(principal, String(old.get("organizationId")));
    const items = old.get("items") as BiblePreviewItem[],
      errors = [...((old.get("errors") as string[]) ?? [])];
    if (new Set(items.map((x) => x.localDate)).size !== items.length)
      errors.push("Duplicate activity date.");
    for (const item of items)
      for (const q of item.questions) {
        if (!q.choices.some((c) => c.id === q.correctChoiceId))
          errors.push(`Correct choice missing for ${item.localDate}/${q.id}.`);
      }
    const status = errors.length ? "needs_review" : "validated";
    await this.db.runTransaction(async (tx) => {
      tx.update(old.ref, {
        status,
        errors: [...new Set(errors)],
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        version: FieldValue.increment(1),
      });
      this.audit(
        tx,
        "bible.import.validated",
        actor.uid,
        String(old.get("organizationId")),
        id,
        requestId,
        {
          status,
          errorCount: errors.length,
          warningCount: ((old.get("warnings") as unknown[]) ?? []).length,
        },
      );
    });
    return this.get(principal, id);
  }
  async commit(
    principal: Principal | undefined,
    id: string,
    ack: boolean,
    requestId: string,
  ) {
    const old = await this.scoped(id, principal),
      actor = this.actor(principal, String(old.get("organizationId")));
    if (old.get("status") === "committed")
      return {
        contentSetId: String(old.get("committedContentSetId")),
        idempotent: true,
      };
    if (old.get("status") !== "validated")
      throw error(
        409,
        "BIBLE_CONTENT_INVALID_STATE",
        "Import must be validated before commit.",
      );
    if (((old.get("warnings") as unknown[]) ?? []).length && !ack)
      throw error(
        422,
        "BIBLE_IMPORT_VALIDATION_FAILED",
        "Explicit warning acknowledgement is required.",
      );
    const content = this.db.doc(`bibleContentSets/${id}`),
      items = old.get("items") as BiblePreviewItem[];
    await this.db.runTransaction(async (tx) => {
      const latest = await tx.get(old.ref),
        existing = await tx.get(content);
      if (latest.get("status") === "committed") return;
      if (existing.exists)
        throw error(
          409,
          "BIBLE_IMPORT_ALREADY_COMMITTED",
          "Import content already exists.",
        );
      tx.create(content, {
        organizationId: old.get("organizationId"),
        quarterId: old.get("quarterId"),
        title: old.get("title"),
        description: "",
        timezone: old.get("timezone") ?? "UTC",
        sourceFiles: {
          quiz: old.get("quizFile"),
          answerKey: old.get("answerKeyFile"),
        },
        sourceChecksums: old.get("sourceChecksums"),
        importId: id,
        version: 1,
        status: "draft",
        createdBy: actor.uid,
        updatedBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      for (const item of items) {
        const ref = this.db.doc(`bibleActivities/${id}_${item.localDate}`);
        const activity: Partial<BiblePreviewItem> = { ...item };
        delete activity.id;
        tx.create(ref, {
          ...activity,
          questions: item.questions,
          contentSetId: content.id,
          organizationId: old.get("organizationId"),
          quarterId: old.get("quarterId"),
          responseType: "multiple_choice",
          status: "draft",
          version: 1,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      tx.update(old.ref, {
        status: "committed",
        committedContentSetId: content.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(
        tx,
        "bible.import.committed",
        actor.uid,
        String(old.get("organizationId")),
        id,
        requestId,
        { contentSetId: content.id, status: "draft" },
      );
    });
    return { contentSetId: content.id, idempotent: false };
  }
  async listContent(principal: Principal | undefined) {
    const actor = this.actor(principal);
    const snap = await this.db.collection("bibleContentSets").limit(100).get();
    return {
      items: snap.docs
        .filter(
          (d) =>
            actor.roles.includes("super_admin") ||
            actor.organizationIds.includes(String(d.get("organizationId"))),
        )
        .map((d) => ({
          id: d.id,
          ...d.data(),
          createdAt: iso(d.get("createdAt")),
          updatedAt: iso(d.get("updatedAt")),
        })),
    };
  }
  async getContent(principal: Principal | undefined, id: string) {
    const d = await this.scoped(id, principal, "bibleContentSets");
    const activities = await this.db
      .collection("bibleActivities")
      .where("contentSetId", "==", id)
      .limit(100)
      .get();
    return {
      id: d.id,
      ...d.data(),
      createdAt: iso(d.get("createdAt")),
      updatedAt: iso(d.get("updatedAt")),
      activities: activities.docs.map((x) => ({
        id: x.id,
        ...x.data(),
        createdAt: iso(x.get("createdAt")),
        updatedAt: iso(x.get("updatedAt")),
      })),
    };
  }
  async updateContent(
    principal: Principal | undefined,
    id: string,
    input: { expectedVersion: number; title?: string; description?: string },
    requestId: string,
  ) {
    const old = await this.scoped(id, principal, "bibleContentSets"),
      actor = this.actor(principal, String(old.get("organizationId")));
    await this.db.runTransaction(async (tx) => {
      const d = await tx.get(old.ref);
      if (d.get("status") !== "draft")
        throw error(
          409,
          "BIBLE_CONTENT_INVALID_STATE",
          "Only draft metadata can be edited.",
        );
      if (Number(d.get("version")) !== input.expectedVersion)
        throw error(
          409,
          "BIBLE_IMPORT_VERSION_CONFLICT",
          "Content version changed.",
        );
      const changes = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      };
      tx.update(old.ref, {
        ...changes,
        version: input.expectedVersion + 1,
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(
        tx,
        "bible.content.updated",
        actor.uid,
        String(d.get("organizationId")),
        id,
        requestId,
        {
          version: input.expectedVersion + 1,
          changedFields: Object.keys(changes),
        },
      );
    });
    return this.getContent(principal, id);
  }
  async transition(
    principal: Principal | undefined,
    id: string,
    input: { expectedVersion: number },
    target: "published" | "archived",
    requestId: string,
  ) {
    const old = await this.scoped(id, principal, "bibleContentSets"),
      actor = this.actor(principal, String(old.get("organizationId")));
    await this.db.runTransaction(async (tx) => {
      const d = await tx.get(old.ref);
      if (Number(d.get("version")) !== input.expectedVersion)
        throw error(
          409,
          "BIBLE_IMPORT_VERSION_CONFLICT",
          "Content version changed.",
        );
      if (target === "published" && d.get("status") !== "draft")
        throw error(
          409,
          "BIBLE_CONTENT_INVALID_STATE",
          "Only draft content can be published.",
        );
      if (target === "archived" && d.get("status") === "archived")
        throw error(
          409,
          "BIBLE_CONTENT_INVALID_STATE",
          "Content is already archived.",
        );
      const q = await tx.get(
        this.db.doc(`quarters/${String(d.get("quarterId"))}`),
      );
      if (target === "published" && (!q.exists || q.get("status") !== "active"))
        throw error(
          409,
          "BIBLE_CONTENT_INVALID_STATE",
          "The quarter must be active.",
        );
      const acts = await tx.get(
        this.db.collection("bibleActivities").where("contentSetId", "==", id),
      );
      if (target === "published") {
        for (const a of acts.docs) {
          const conflicts = await tx.get(
            this.db
              .collection("bibleActivities")
              .where("organizationId", "==", d.get("organizationId"))
              .where("quarterId", "==", d.get("quarterId"))
              .where("localDate", "==", a.get("localDate"))
              .where("status", "==", "published"),
          );
          if (!conflicts.empty)
            throw error(
              409,
              "BIBLE_CONTENT_DATE_CONFLICT",
              "A published activity already exists for a date.",
            );
        }
      }
      tx.update(old.ref, {
        status: target,
        version: input.expectedVersion + 1,
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(target === "published"
          ? {
              publishedAt: FieldValue.serverTimestamp(),
              publishedBy: actor.uid,
            }
          : {}),
      });
      for (const a of acts.docs)
        tx.update(a.ref, {
          status: target,
          updatedAt: FieldValue.serverTimestamp(),
        });
      this.audit(
        tx,
        target === "published"
          ? "bible.content.published"
          : "bible.content.archived",
        actor.uid,
        String(d.get("organizationId")),
        id,
        requestId,
        { status: target, version: input.expectedVersion + 1 },
      );
    });
    return this.getContent(principal, id);
  }
}
