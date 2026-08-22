import { Router, type RequestHandler } from "express";
import { db } from "../config/firebase.js";
import { importBucket } from "../config/storage-readiness.js";
import { validateBody } from "../middleware/validate.js";
import { AppError, ValidationError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import { idSchema } from "../shared/validation.js";
import {
  importMetadataSchema,
  importCommandSchema,
  importListQuerySchema,
  itemPatchSchema,
  lifecycleSchema,
} from "./domain.js";
import { BibleAdministrationService, type Upload } from "./service.js";

const router = Router(),
  service = new BibleAdministrationService(db, importBucket),
  MAX_FILE = 5 * 1024 * 1024,
  MAX_REQUEST = MAX_FILE * 2 + 64 * 1024,
  FILE_FIELDS = ["quizFile", "answerKeyFile"] as const,
  TEXT_FIELDS = ["organizationId", "quarterId", "title"] as const;
const run =
  (
    fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>,
    status = 200,
  ): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(status).json({ data: await fn(req) });
    } catch (e) {
      next(e);
    }
  };
const id = (v: unknown) => {
  const p = idSchema.safeParse(v);
  if (!p.success) throw new ValidationError();
  return p.data;
};
const multipart: RequestHandler = async (req, _res, next) => {
  try {
    const ct = req.headers["content-type"] ?? "",
      m = /multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    if (!m)
      throw new AppError(
        415,
        "BIBLE_IMPORT_FILE_INVALID",
        "multipart/form-data is required.",
      );
    const boundary = m[1] ?? m[2]!;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const part of req) {
      const b = Buffer.isBuffer(part) ? part : Buffer.from(part as Uint8Array);
      size += b.length;
      if (size > MAX_REQUEST)
        throw new AppError(
          413,
          "BIBLE_IMPORT_FILE_INVALID",
          "Upload request exceeds the multipart size limit.",
        );
      chunks.push(b);
    }
    const body = Buffer.concat(chunks),
      delimiter = Buffer.from(`--${boundary}`),
      files: Record<string, Upload> = {},
      fields: Record<string, string> = {};
    let start = body.indexOf(delimiter) + delimiter.length;
    while (start >= delimiter.length) {
      if (body.subarray(start, start + 2).toString() === "--") break;
      start += 2;
      const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), start);
      if (headerEnd < 0) break;
      const headers = body.subarray(start, headerEnd).toString("utf8"),
        next = body.indexOf(delimiter, headerEnd + 4);
      if (next < 0) break;
      const content = body.subarray(headerEnd + 4, next - 2),
        name = /name="([^"]+)"/.exec(headers)?.[1],
        filename = /filename="([^"]*)"/.exec(headers)?.[1];
      if (name) {
        if (filename !== undefined) {
          if (!(FILE_FIELDS as readonly string[]).includes(name))
            throw new ValidationError("Invalid multipart fields.", {
              fieldErrors: { [name]: ["Unexpected file field."] },
            });
          if (files[name])
            throw new ValidationError("Invalid multipart fields.", {
              fieldErrors: { [name]: ["Only one file is allowed."] },
            });
          if (content.length > MAX_FILE)
            throw new ValidationError("Invalid multipart fields.", {
              fieldErrors: { [name]: ["File must not exceed 5 MiB."] },
            });
          files[name] = {
            name: filename,
            mime:
              /Content-Type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ??
              "application/octet-stream",
            buffer: content,
          };
        } else {
          if (!(TEXT_FIELDS as readonly string[]).includes(name))
            throw new ValidationError("Invalid multipart fields.", {
              fieldErrors: { [name]: ["Unexpected text field."] },
            });
          fields[name] = content.toString("utf8");
        }
      }
      start = next + delimiter.length;
    }
    req.body = { ...fields, __files: files };
    next();
  } catch (e) {
    next(e);
  }
};
router.post(
  ["/bible-content/imports", "/bible-imports"],
  multipart,
  run((req) => {
    const body = importMetadataSchema.safeParse(req.body);
    const files = (req.body as { __files?: Record<string, Upload> }).__files;
    const fieldErrors: Record<string, string[]> = body.success
      ? {}
      : body.error.flatten().fieldErrors;
    if (!files?.quizFile) fieldErrors.quizFile = ["quizFile is required."];
    if (!files?.answerKeyFile)
      fieldErrors.answerKeyFile = ["answerKeyFile is required."];
    if (Object.keys(fieldErrors).length) {
      logger.warn("bible_import_multipart_rejected", {
        requestId: req.requestId,
        actorId: req.principal?.uid,
        receivedTextFields: TEXT_FIELDS.filter(
          (field) => typeof req.body?.[field] === "string",
        ),
        receivedFileFields: FILE_FIELDS.filter((field) =>
          Boolean(files?.[field]),
        ),
        invalidFields: Object.keys(fieldErrors),
      });
      throw new ValidationError("Invalid Bible import fields.", {
        fieldErrors,
      });
    }
    if (!body.success || !files?.quizFile || !files.answerKeyFile)
      throw new ValidationError("Invalid Bible import fields.");
    return service.create(
      req.principal,
      body.data,
      files.quizFile,
      files.answerKeyFile,
      req.requestId,
      req.header("idempotency-key")?.trim(),
    );
  }, 201),
);
router.get(
  ["/bible-content/imports", "/bible-imports"],
  run(async (req) => {
    const query = importListQuerySchema.safeParse(req.query);
    if (!query.success) throw new ValidationError("Invalid import list query.");

    const limit = query.data.pageSize ?? query.data.limit;

    const result = (await service.listImports(req.principal, {
      ...query.data,
      limit,
    })) as Record<string, any>;

    // Safely extract the items array regardless of whether service returns
    // { items: [...] }, { imports: { items: [...] } }, or a bare array [...]
    const rawItems = Array.isArray(result)
      ? result
      : Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result?.imports?.items)
          ? result.imports.items
          : Array.isArray(result?.imports)
            ? result.imports
            : [];

    const page = query.data.page ?? 1;
    const total = Number(result?.total ?? result?.pagination?.total ?? rawItems.length);

    return {
      imports: {
        items: rawItems,
        pagination: {
          page,
          pageSize: limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      meta: result?.meta ?? { nextCursor: null },
    };
  }),
);
// router.get(
//   ["/bible-content/imports", "/bible-imports"],
//   run(async (req) => {
//     const query = importListQuerySchema.safeParse(req.query);
//     if (!query.success) throw new ValidationError("Invalid import list query.");

//     const result = await service.listImports(req.principal, query.data);
//     const items = (result as { items?: unknown[] }).items ?? (Array.isArray(result) ? result : []);
//     const page = query.data.page ?? 1;
//     const pageSize = query.data.pageSize ?? query.data.limit ?? 25;
//     const total = (result as { total?: number }).total ?? items.length;

//     return {
//       imports: {
//         items,
//         pagination: {
//           page,
//           pageSize,
//           total,
//           totalPages: Math.ceil(total / pageSize) || 1,
//         },
//       },
//       meta: (result as { meta?: unknown }).meta ?? { nextCursor: null },
//     };
//   }),
// );

router.get(
  ["/bible-content/imports/:importId", "/bible-imports/:importId"],
  run((req) => service.get(req.principal, id(req.params.importId))),
);
router.patch(
  [
    "/bible-content/imports/:importId/items/:itemId",
    "/bible-imports/:importId/items/:itemId",
  ],
  validateBody(itemPatchSchema),
  run((req) =>
    service.patchItem(
      req.principal,
      id(req.params.importId),
      id(req.params.itemId),
      req.body,
      req.requestId,
    ),
  ),
);
router.post(
  [
    "/bible-content/imports/:importId/validate",
    "/bible-imports/:importId/validate",
  ],
  run((req) =>
    service.validate(req.principal, id(req.params.importId), req.requestId),
  ),
);
router.post(
  [
    "/bible-content/imports/:importId/commit",
    "/bible-imports/:importId/commit",
  ],
  validateBody(importCommandSchema),
  run((req) =>
    service.commit(
      req.principal,
      id(req.params.importId),
      req.body,
      req.requestId,
    ),
  ),
);
router.post(
  [
    "/bible-content/imports/:importId/reprocess",
    "/bible-imports/:importId/reprocess",
  ],
  validateBody(importCommandSchema),
  run((req) =>
    service.reprocess(
      req.principal,
      id(req.params.importId),
      req.body,
      req.requestId,
    ),
  ),
);
router.post(
  [
    "/bible-content/imports/:importId/reject",
    "/bible-imports/:importId/reject",
  ],
  validateBody(importCommandSchema),
  run((req) =>
    service.reject(
      req.principal,
      id(req.params.importId),
      req.body,
      req.requestId,
    ),
  ),
);
router.get(
  [
    "/bible-content/imports/:importId/documents/:kind",
    "/bible-imports/:importId/documents/:kind",
  ],
  async (req, res, next) => {
    try {
      const document = await service.downloadDocument(
        req.principal,
        id(req.params.importId),
        req.params.kind === "question"
          ? "question"
          : req.params.kind === "answer-key"
            ? "answerKey"
            : undefined,
        req.requestId,
      );
      res.setHeader("Content-Type", document.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.send(document.data);
    } catch (e) {
      next(e);
    }
  },
);
router.get(
  "/bible-content",
  run((req) => service.listContent(req.principal)),
);
router.get(
  "/bible-content/:contentSetId",
  run((req) => service.getContent(req.principal, id(req.params.contentSetId))),
);
router.patch(
  "/bible-content/:contentSetId",
  validateBody(
    lifecycleSchema.extend({
      title: importMetadataSchema.shape.title.optional(),
      description: importMetadataSchema.shape.title.max(2000).optional(),
    }),
  ),
  run((req) =>
    service.updateContent(
      req.principal,
      id(req.params.contentSetId),
      req.body,
      req.requestId,
    ),
  ),
);
router.post(
  "/bible-content/:contentSetId/publish",
  validateBody(lifecycleSchema),
  run((req) =>
    service.transition(
      req.principal,
      id(req.params.contentSetId),
      req.body,
      "published",
      req.requestId,
    ),
  ),
);
router.post(
  "/bible-content/:contentSetId/archive",
  validateBody(lifecycleSchema),
  run((req) =>
    service.transition(
      req.principal,
      id(req.params.contentSetId),
      req.body,
      "archived",
      req.requestId,
    ),
  ),
);
export default router;
