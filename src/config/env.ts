import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_ENV: z
    .enum(["development", "staging", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  FIREBASE_PROJECT_ID: z.string().min(1).default("grounded-fruitful-local"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:4200"),
  CHILD_LOGIN_PEPPER: z.string().min(16).default("local-emulator-only-pepper"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export const env = schema.parse(process.env);
export const allowedOrigins = new Set(
  env.ALLOWED_ORIGINS.split(",")
    .map((v) => v.trim())
    .filter(Boolean),
);
