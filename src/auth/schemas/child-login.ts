import { z } from "zod";
export const childLoginSchema = z
  .object({
    familyCode: z.string().trim().min(4).max(32),
    handle: z.string().trim().min(2).max(32),
    pin: z.string().min(4).max(128),
  })
  .strict();
export type ChildLogin = z.infer<typeof childLoginSchema>;
