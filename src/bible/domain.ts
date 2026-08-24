import { z } from "zod";

export const PARSER_VERSION = "gf-bible-ooxml/2.0.0";
export const choiceSchema = z.object({
  id: z.string().regex(/^[a-e]$/),
  label: z.string().regex(/^[a-e]$/),
  text: z.string().min(1).max(1000),
  isCorrect: z.boolean(),
});
export const questionSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  position: z.number().int().positive(),
  prompt: z.string().min(1).max(4000),
  choices: z.array(choiceSchema).min(2).max(5),
  correctChoiceId: z.string().regex(/^[a-e]$/),
  originalText: z.string().max(10000),
  version: z.number().int().positive(),
});
export const previewItemSchema = z.object({
  id: z.string().min(1),
  month: z.number().int().min(1).max(12),
  dayOfMonth: z.number().int().min(1).max(31),
  localDate: z.string().date(),
  scriptureReference: z.string().min(1).max(500),
  title: z.string().min(1).max(1000),
  position: z.number().int().positive(),
  questions: z.array(questionSchema).min(1).max(20),
  originalText: z.string().max(100000),
  version: z.number().int().positive(),
});
export type BiblePreviewItem = z.infer<typeof previewItemSchema>;
export const answerInputSchema = z.object({
  questionId: z.string().min(1).max(128),
  selectedChoiceId: z.string().regex(/^[a-e]$/),
});
export const responseInputSchema = z.object({
  answers: z.array(answerInputSchema).min(1).max(20),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export const importMetadataSchema = z.object({
  organizationId: z.string().min(1).max(128),
  quarterId: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(200),
});
export const lifecycleSchema = z.object({
  expectedVersion: z.number().int().positive(),
  acknowledgeWarnings: z.boolean().optional(),
  idempotencyKey: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,128}$/)
    .optional(),
});
export const importListQuerySchema = z.object({
  status: z
    .enum([
      "uploaded",
      "processing",
      "processing_failed",
      "needs_correction",
      "needs_review",
      "committing",
      "committed",
      "rejected",
      "cancelled",
      "expired",
    ])
    .optional(),
  quarterId: z.string().min(1).max(128).optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().max(512).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export const importCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)
  .optional(),
});
export const itemPatchSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(1000).optional(),
  scriptureReference: z.string().trim().min(1).max(500).optional(),
  questions: z
    .array(
      questionSchema
        .omit({ version: true })
        .extend({ version: z.number().int().positive().optional() }),
    )
    .min(1)
    .max(20)
    .optional(),
});
export const bibleCompletionKey = (participantId: string, activityId: string) =>
  `BIBLE:${participantId}:${activityId}`;
