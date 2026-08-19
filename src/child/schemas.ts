import { z } from "zod";

const safeText = (max: number) => z.string().trim().min(1).max(max);
export const characterResponseSchema = z.object({
  qualityId: z.string().min(1).max(128),
  rating: z.number().int().min(0).max(10),
  reflection: z.string().trim().max(2000).optional(),
});
export const checkInSchema = z.object({
  heartMindResponse: z.object({ mood: safeText(64), note: z.string().trim().max(2000).optional() }),
  gratitudeResponse: z.string().trim().max(2000),
  characterResponses: z.array(characterResponseSchema).max(5),
  bibleResponse: z.object({ activityId: z.string().max(128), response: z.string().max(4000) }).optional(),
});
export const characterAssessmentSchema = z.object({ responses: z.array(characterResponseSchema).max(5) });
export const activityResponseSchema = z.object({
  status: z.enum(["draft", "completed"]),
  response: z.discriminatedUnion("type", [
    z.object({ type: z.literal("reflection"), text: safeText(4000) }),
    z.object({ type: z.literal("scripture"), text: safeText(4000) }),
    z.object({ type: z.literal("memory_verse"), text: safeText(4000) }),
    z.object({ type: z.literal("multiple_choice"), optionId: safeText(128) }),
    z.object({ type: z.literal("true_false"), value: z.boolean() }),
    z.object({ type: z.literal("reading_reflection"), text: safeText(4000), progress: z.number().int().min(0).max(100) }),
  ]),
});
export const projectCreateSchema = z.object({ title: safeText(120), description: z.string().trim().max(4000).default("") });
export const projectPatchSchema = z.object({
  version: z.number().int().positive(), title: safeText(120).optional(), description: z.string().trim().max(4000).optional(),
  status: z.enum(["idea", "goal", "plan", "action", "progress", "reflection", "completion"]).optional(),
});
export const milestoneSchema = z.object({ title: safeText(160), dueDate: z.string().date().optional() });
export const updateSchema = z.object({ text: safeText(4000), milestoneId: z.string().max(128).optional(), completeMilestone: z.boolean().default(false) });
export type CheckInInput = z.infer<typeof checkInSchema>;
