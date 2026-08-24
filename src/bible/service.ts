/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-condition */
import { createHash, randomUUID } from "node:crypto";
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
    download(): Promise<[Buffer]>;
  };
}
const storageFailure = (cause: unknown) => {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String(cause.code)
      : undefined;
  const permissionDenied = code === "401" || code === "403";
  const unavailable =
    code === "404" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "503";
  return {
    code: permissionDenied
      ? "BIBLE_IMPORT_STORAGE_PERMISSION_DENIED"
      : unavailable
        ? "BIBLE_IMPORT_STORAGE_UNAVAILABLE"
        : "BIBLE_IMPORT_STORAGE_UPLOAD_FAILED",
    message: permissionDenied
      ? "Bible import storage permission was denied."
      : unavailable
        ? "Bible import storage is temporarily unavailable."
        : "Bible import source upload failed.",
    providerCode: code,
  } as const;
};
const firstApplicationFrame = (cause: unknown) =>
  cause instanceof Error
    ? cause.stack
        ?.split("\n")
        .slice(1)
        .map((line) => line.trim())
        .find((line) => line.includes("/src/"))
    : undefined;
export interface Upload {
  name: string;
  mime: string;
  buffer: Buffer;
}

/**
 * Keep the persisted local-date name while satisfying the admin review
 * contract, which calls the same value `date`.
 */
export const serializeImportPreviewActivity = (
  activity: Record<string, unknown>,
) => {
  const questions = Array.isArray(activity.questions)
    ? activity.questions.map((question, index) => {
        if (!question || typeof question !== "object") return question;
        const data = question as Record<string, unknown>;
        return {
          ...data,
          // Older imports predate the explicit review-contract field. Their
          // persisted position is the original ordinal and is safe to expose.
          number: data.number ?? data.position ?? index + 1,
        };
      })
    : activity.questions;
  return {
    ...activity,
    date: activity.date ?? activity.localDate,
    ...(questions === undefined ? {} : { questions }),
  };
};

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
  private can(actor: Principal, capability: string) {
    return Boolean(
      actor.capabilities?.includes(capability) ||
      actor.capabilities?.includes("admin.bible_content.manage"),
    );
  }
  private actions(actor: Principal, data: Record<string, unknown>) {
    const actions = this.can(actor, "admin.bible_content.read") ? ["view"] : [];
    const errors = Number(
      data.errorCount ?? (data.errors as unknown[] | undefined)?.length ?? 0,
    );
    if (
      data.status === "needs_review" &&
      this.can(actor, "admin.bible_content.review")
    )
      actions.push("review", "reject");
    if (
      data.status === "needs_review" &&
      errors === 0 &&
      this.can(actor, "admin.bible_content.commit")
    )
      actions.push("commit");
    if (
      ["processing_failed", "needs_correction"].includes(String(data.status)) &&
      this.can(actor, "admin.bible_content.review")
    )
      actions.push("reprocess");
    return actions;
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
    idempotencyKey?: string,
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
      throw new AppError(
        503,
        "BIBLE_IMPORT_STORAGE_NOT_CONFIGURED",
        "Bible import storage is not configured.",
      );
    if (idempotencyKey && !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey))
      throw new ValidationError("Invalid idempotency key.", {
        fieldErrors: {
          idempotencyKey: ["Use 8-128 letters, numbers, '_' or '-'."],
        },
      });
    if (idempotencyKey) {
      const previous = await this.db
        .collection("bibleImports")
        .where("organizationId", "==", metadata.organizationId)
        .where("idempotencyKey", "==", idempotencyKey)
        .limit(1)
        .get();
      if (!previous.empty) return this.get(principal, previous.docs[0]!.id);
    }
    const ref = this.db.collection("bibleImports").doc(),
      objectPrefix = `organizations/${metadata.organizationId}/bible-imports/${ref.id}/source`,
      quizPath = `${objectPrefix}/questions.docx`,
      keyPath = `${objectPrefix}/answer-key.docx`,
      stored: string[] = [];
    try {
      for (const [path, file] of [
        [quizPath, quiz],
        [keyPath, key],
      ] as const) {
        await this.bucket.file(path).save(file.buffer, {
          resumable: false,
          contentType: file.mime,
          predefinedAcl: "private",
          metadata: {
            cacheControl: "private, no-store",
            metadata: {
              originalFilename: safeName(file.name),
              sourceSize: String(file.buffer.length),
            },
          },
        });
        stored.push(path);
      }
      phase("storage_completed", {
        importId: ref.id,
        objectCount: stored.length,
      });
      await this.db.runTransaction(async (tx) => {
        const duplicate = idempotencyKey
          ? await tx.get(
              this.db
                .collection("bibleImports")
                .where("organizationId", "==", metadata.organizationId)
                .where("idempotencyKey", "==", idempotencyKey),
            )
          : undefined;
        if (duplicate && !duplicate.empty)
          throw error(
            409,
            "BIBLE_IMPORT_IDEMPOTENCY_CONFLICT",
            "An import already exists for this request ID.",
          );
        const sourceDocuments = {
          question: {
            originalFilename: safeName(quiz.name),
            storagePath: quizPath,
            contentType: quiz.mime,
            size: quiz.buffer.length,
            sha256: createHash("sha256").update(quiz.buffer).digest("hex"),
          },
          answerKey: {
            originalFilename: safeName(key.name),
            storagePath: keyPath,
            contentType: key.mime,
            size: key.buffer.length,
            sha256: createHash("sha256").update(key.buffer).digest("hex"),
          },
        };
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
          sourceDocuments,
          requestId,
          idempotencyKey: idempotencyKey ?? null,
          sourceChecksums: result.checksums,
          parserVersion: result.parserVersion,
          templateVersion: "gf-bible-docx/1",
          warnings: result.warnings,
          errors: result.errors,
          validationSummary: {
            activityCount: result.items.length,
            errorCount: result.errors.length,
            warningCount: result.warnings.length,
          },
          activityCount: result.items.length,
          questionCount: result.items.reduce(
            (count, item) => count + item.questions.length,
            0,
          ),
          warningCount: result.warnings.length,
          errorCount: result.errors.length,
          version: 1,
          createdBy: actor.uid,
          updatedBy: actor.uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        for (const item of result.items)
          tx.create(ref.collection("activities").doc(item.id), {
            ...item,
            organizationId: metadata.organizationId,
            createdAt: FieldValue.serverTimestamp(),
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
      const cleanup = await Promise.allSettled(
        stored.map((path) =>
          this.bucket!.file(path).delete({ ignoreNotFound: true }),
        ),
      );
      const failedCleanupPaths = cleanup.flatMap((entry, index) =>
        entry.status === "rejected" ? [stored[index]!] : [],
      );
      if (failedCleanupPaths.length) {
        await this.db.collection("bibleImportCleanupJobs").add({
          organizationId: metadata.organizationId,
          importId: ref.id,
          storagePaths: failedCleanupPaths,
          status: "pending",
          attempts: 0,
          createdAt: FieldValue.serverTimestamp(),
        });
        logger.error("bible_import.cleanup_pending", {
          requestId,
          importId: ref.id,
          failedObjectCount: failedCleanupPaths.length,
          safeErrorCode: "BIBLE_IMPORT_STORAGE_CLEANUP_PENDING",
        });
        throw new AppError(
          503,
          "BIBLE_IMPORT_STORAGE_CLEANUP_PENDING",
          "Bible import storage cleanup is pending.",
        );
      }
      if (cause instanceof AppError) throw cause;
      const failure = stored.length < 2 ? storageFailure(cause) : undefined;
      logger.error("bible_import.failed", {
        requestId,
        actorId: actor.uid,
        organizationId: metadata.organizationId,
        quarterId: metadata.quarterId,
        importId: ref.id,
        phase: stored.length < 2 ? "storage" : "persistence",
        durationMs: Date.now() - startedAt,
        errorType: cause instanceof Error ? cause.name : "unknown",
        providerMessage:
          cause instanceof Error ? cause.message.slice(0, 500) : undefined,
        safeProviderCode: failure?.providerCode,
        firstApplicationFrame: firstApplicationFrame(cause),
        safeErrorCode:
          stored.length < 2 ? failure!.code : "BIBLE_IMPORT_PERSISTENCE_FAILED",
      });
      throw error(
        stored.length < 2 ? 503 : 500,
        stored.length < 2 ? failure!.code : "BIBLE_IMPORT_PERSISTENCE_FAILED",
        stored.length < 2
          ? failure!.message
          : "Bible import persistence failed.",
      );
    }
    return this.get(principal, ref.id);
  }
  async get(principal: Principal | undefined, id: string) {
    const d = await this.scoped(id, principal);
    const actor = this.actor(principal, String(d.get("organizationId")));
    const [quarter, preview, timeline] = await Promise.all([
      this.db.doc(`quarters/${String(d.get("quarterId"))}`).get(),
      d.ref.collection("activities").orderBy("position").limit(25).get(),
      this.db
        .collection("auditLogs")
        .where("targetId", "==", id)
        .limit(50)
        .get(),
    ]);
    const source = d.get("sourceDocuments") as
      | Record<string, Record<string, unknown>>
      | undefined;
    const question = source?.question ?? d.get("quizFile") ?? {};
    const answerKey = source?.answerKey ?? d.get("answerKeyFile") ?? {};
    const data = d.data()!;
    return {
      id: d.id,
      organizationId: d.get("organizationId"),
      organization: { id: d.get("organizationId") },
      quarterId: d.get("quarterId"),
      quarter: quarter.exists
        ? {
            id: quarter.id,
            name: quarter.get("name") ?? quarter.get("title") ?? "",
            startDate: quarter.get("startDate"),
            endDate: quarter.get("endDate"),
          }
        : null,
      title: d.get("title"),
      status: d.get("status"),
      documents: {
        question: {
          filename: question.originalFilename ?? question.displayName,
          size: question.size,
        },
        answerKey: {
          filename: answerKey.originalFilename ?? answerKey.displayName,
          size: answerKey.size,
        },
      },
      sourceChecksums: d.get("sourceChecksums"),
      parserVersion: d.get("parserVersion"),
      activities: preview.docs.map((item) =>
        serializeImportPreviewActivity(item.data()),
      ),
      preview: { limit: 25, hasMore: preview.size === 25 },
      warnings: d.get("warnings") ?? [],
      errors: d.get("errors") ?? [],
      validationSummary: d.get("validationSummary"),
      summary: {
        activityCount: Number(
          d.get("activityCount") ??
            d.get("validationSummary.activityCount") ??
            preview.size,
        ),
        questionCount: Number(d.get("questionCount") ?? 0),
        warningCount: Number(
          d.get("warningCount") ?? (d.get("warnings") ?? []).length,
        ),
        errorCount: Number(
          d.get("errorCount") ?? (d.get("errors") ?? []).length,
        ),
      },
      processing: {
        startedAt: iso(d.get("processingStartedAt")),
        completedAt: iso(d.get("processingCompletedAt")),
      },
      templateVersion: d.get("templateVersion") ?? null,
      allowedActions: this.actions(actor, data),
      timeline: timeline.docs.map((entry) => ({
        event: entry.get("event"),
        timestamp: iso(entry.get("timestamp")),
      })),
      version: d.get("version"),
      committedContentSetId: d.get("committedContentSetId") ?? null,
      createdAt: iso(d.get("createdAt")),
      updatedAt: iso(d.get("updatedAt")),
    };
  }
  async listImports(
    principal: Principal | undefined,
    query: {
      status?: string | undefined;
      quarterId?: string | undefined;
      search?: string | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ) {
    const actor = this.actor(principal);
    let ref: FirebaseFirestore.Query = this.db.collection("bibleImports");
    if (query.status) ref = ref.where("status", "==", query.status);
    if (query.quarterId) ref = ref.where("quarterId", "==", query.quarterId);
    ref = ref.orderBy("updatedAt", "desc").orderBy("__name__", "desc");
    if (query.cursor) {
      let decoded: { updatedAt: string; id: string };
      try {
        decoded = JSON.parse(
          Buffer.from(query.cursor, "base64url").toString(),
        ) as typeof decoded;
      } catch {
        throw new ValidationError("Invalid import list cursor.");
      }
      ref = ref.startAfter(new Date(decoded.updatedAt), decoded.id);
    }
    const snap = await ref.limit(query.limit + 1).get();
    const scoped = snap.docs.filter(
      (d) =>
        actor.roles.includes("super_admin") ||
        actor.organizationIds.includes(String(d.get("organizationId"))),
    );
    const visible = scoped.filter(
      (d) =>
        !query.search ||
        String(d.get("title") ?? "")
          .toLowerCase()
          .includes(query.search.toLowerCase()),
    );
    const page = visible.slice(0, query.limit);
    const quarters = await Promise.all(
      page.map((d) =>
        this.db.doc(`quarters/${String(d.get("quarterId"))}`).get(),
      ),
    );
    return {
      items: page.map((d, index) => {
        const data = d.data(),
          source = data.sourceDocuments ?? {};
        return {
          id: d.id,
          title: data.title,
          status: data.status,
          quarter: quarters[index]!.exists
            ? {
                id: quarters[index]!.id,
                name:
                  quarters[index]!.get("name") ??
                  quarters[index]!.get("title") ??
                  "",
                startDate: quarters[index]!.get("startDate"),
                endDate: quarters[index]!.get("endDate"),
              }
            : null,
          questionFilename:
            source.question?.originalFilename ?? data.quizFile?.displayName,
          answerKeyFilename:
            source.answerKey?.originalFilename ??
            data.answerKeyFile?.displayName,
          activityCount: Number(
            data.activityCount ?? data.validationSummary?.activityCount ?? 0,
          ),
          questionCount: Number(data.questionCount ?? 0),
          warningCount: Number(data.warningCount ?? data.warnings?.length ?? 0),
          errorCount: Number(data.errorCount ?? data.errors?.length ?? 0),
          createdAt: iso(data.createdAt),
          updatedAt: iso(data.updatedAt),
          version: data.version,
          committedContentSetId: data.committedContentSetId ?? null,
          allowedActions: this.actions(actor, data),
        };
      }),
      meta: {
        nextCursor:
          snap.size > query.limit && page.length
            ? Buffer.from(
                JSON.stringify({
                  updatedAt: iso(page.at(-1)!.get("updatedAt")),
                  id: page.at(-1)!.id,
                }),
              ).toString("base64url")
            : null,
      },
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
    const itemRef = old.ref.collection("activities").doc(itemId);
    await this.db.runTransaction(async (tx) => {
      const [d, item] = await Promise.all([tx.get(old.ref), tx.get(itemRef)]);
      const changes = {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.scriptureReference === undefined
          ? {}
          : { scriptureReference: input.scriptureReference }),
        ...(input.questions === undefined
          ? {}
          : { questions: input.questions }),
      };
      if (!item.exists)
        throw error(404, "BIBLE_CONTENT_NOT_FOUND", "Preview item not found.");
      if (Number(item.get("version")) !== input.expectedVersion)
        throw error(
          409,
          "BIBLE_IMPORT_VERSION_CONFLICT",
          "Preview item version changed.",
        );
      tx.update(itemRef, { ...changes, version: input.expectedVersion + 1 });
      tx.update(old.ref, {
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
        { itemId, newVersion: input.expectedVersion + 1 },
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
    const parsed = await old.ref.collection("activities").limit(200).get();
    const items = parsed.docs.map((item) => item.data() as BiblePreviewItem),
      errors = [...((old.get("errors") as string[]) ?? [])];
    if (new Set(items.map((x) => x.localDate)).size !== items.length)
      errors.push("Duplicate activity date.");
    for (const item of items)
      for (const q of item.questions) {
        if (!q.choices.some((c) => c.id === q.correctChoiceId))
          errors.push(`Correct choice missing for ${item.localDate}/${q.id}.`);
      }
    const status = errors.length ? "needs_correction" : "needs_review";
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
    input: { expectedVersion: number; idempotencyKey: string },
    requestId: string,
  ) {
    const old = await this.scoped(id, principal),
      actor = this.actor(principal, String(old.get("organizationId")));
    if (old.get("status") === "committed")
      return {
        contentSetId: String(old.get("committedContentSetId")),
        idempotent: true,
      };
    if (!this.can(actor, "admin.bible_content.commit"))
      throw new AuthorizationError();
    if (old.get("status") !== "needs_review")
      throw error(
        409,
        "BIBLE_CONTENT_INVALID_STATE",
        "Import must be ready for review before commit.",
      );
    if (Number(old.get("version")) !== input.expectedVersion)
      throw error(
        409,
        "BIBLE_IMPORT_VERSION_CONFLICT",
        "Import version changed.",
      );
    if (((old.get("errors") as unknown[]) ?? []).length)
      throw error(
        422,
        "BIBLE_IMPORT_VALIDATION_FAILED",
        "Blocking import errors must be corrected before commit.",
      );
    const content = this.db.doc(`bibleContentSets/${id}`),
      parsed = await old.ref.collection("activities").orderBy("position").get(),
      items = parsed.empty
        ? ((old.get("items") as BiblePreviewItem[]) ?? [])
        : parsed.docs.map((d) => d.data() as BiblePreviewItem);
    await this.db.runTransaction(async (tx) => {
      const latest = await tx.get(old.ref),
        existing = await tx.get(content);
      if (latest.get("status") === "committed") return;
      if (Number(latest.get("version")) !== input.expectedVersion)
        throw error(
          409,
          "BIBLE_IMPORT_VERSION_CONFLICT",
          "Import version changed.",
        );
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
        importCommitIdempotencyKey: input.idempotencyKey,
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
        commitIdempotencyKey: input.idempotencyKey,
        version: input.expectedVersion + 1,
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
    return {
      contentSetId: content.id,
      status: "draft",
      navigationTarget: `/admin/bible/content/${content.id}`,
      idempotent: false,
    };
  }
  async reject(
    principal: Principal | undefined,
    id: string,
    input: { expectedVersion: number; idempotencyKey: string },
    requestId: string,
  ) {
    const old = await this.scoped(id, principal),
      actor = this.actor(principal, String(old.get("organizationId")));
    if (!this.can(actor, "admin.bible_content.review"))
      throw new AuthorizationError();
    await this.db.runTransaction(async (tx) => {
      const current = await tx.get(old.ref);
      if (
        current.get("status") === "rejected" &&
        current.get("rejectIdempotencyKey") === input.idempotencyKey
      )
        return;
      if (
        current.get("status") !== "needs_review" ||
        Number(current.get("version")) !== input.expectedVersion
      )
        throw error(
          409,
          "BIBLE_CONTENT_INVALID_STATE",
          "Import cannot be rejected in its current state.",
        );
      tx.update(old.ref, {
        status: "rejected",
        rejectIdempotencyKey: input.idempotencyKey,
        version: input.expectedVersion + 1,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      });
      this.audit(
        tx,
        "bible.import.rejected",
        actor.uid,
        String(current.get("organizationId")),
        id,
        requestId,
        { version: input.expectedVersion + 1 },
      );
    });
    return this.get(principal, id);
  }
  async reprocess(
    principal: Principal | undefined,
    id: string,
    input: { expectedVersion: number; idempotencyKey: string },
    requestId: string,
  ) {
    const old = await this.scoped(id, principal),
      actor = this.actor(principal, String(old.get("organizationId")));
    if (!this.can(actor, "admin.bible_content.review"))
      throw new AuthorizationError();
    await this.db.runTransaction(async (tx) => {
      const current = await tx.get(old.ref);
      if (
        !["needs_correction", "processing_failed"].includes(
          String(current.get("status")),
        ) ||
        Number(current.get("version")) !== input.expectedVersion
      )
        throw error(
          409,
          "BIBLE_CONTENT_INVALID_STATE",
          "Import cannot be reprocessed in its current state.",
        );
      tx.update(old.ref, {
        status: "processing",
        reprocessIdempotencyKey: input.idempotencyKey,
        version: input.expectedVersion + 1,
        processingStartedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(
        tx,
        "bible.import.reprocessing_requested",
        actor.uid,
        String(current.get("organizationId")),
        id,
        requestId,
        { version: input.expectedVersion + 1 },
      );
    });
    return this.get(principal, id);
  }
  async downloadDocument(
    principal: Principal | undefined,
    id: string,
    kind: "question" | "answerKey" | undefined,
    requestId: string,
  ) {
    if (!kind)
      throw error(404, "BIBLE_CONTENT_NOT_FOUND", "Document not found.");
    const old = await this.scoped(id, principal),
      actor = this.actor(principal, String(old.get("organizationId")));
    if (!this.can(actor, "admin.bible_content.source_documents.read"))
      throw new AuthorizationError();
    if (!this.bucket)
      throw error(
        503,
        "BIBLE_IMPORT_STORAGE_NOT_CONFIGURED",
        "Bible import storage is not configured.",
      );
    const source =
      old.get(`sourceDocuments.${kind}`) ??
      old.get(kind === "question" ? "quizFile" : "answerKeyFile");
    if (!source?.storagePath)
      throw error(404, "BIBLE_CONTENT_NOT_FOUND", "Document not found.");
    if (kind === "answerKey")
      await this.db.runTransaction(async (tx) =>
        this.audit(
          tx,
          "bible.import.answer_key_accessed",
          actor.uid,
          String(old.get("organizationId")),
          id,
          requestId,
          { document: "answerKey" },
        ),
      );
    const [data] = await this.bucket
      .file(String(source.storagePath))
      .download();
    return {
      data,
      filename: safeName(
        String(
          source.originalFilename ?? source.displayName ?? "document.docx",
        ),
      ),
      contentType: String(
        source.contentType ??
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    };
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
