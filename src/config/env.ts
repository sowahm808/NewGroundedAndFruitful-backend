import { z } from "zod";

const emptyStringAsUndefined = (value: unknown) =>
  value === "" ? undefined : value;

const optionalWithDefault = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(emptyStringAsUndefined, schema);

export const firebaseEnvSchema = z
  .object({
    NODE_ENV: optionalWithDefault(
      z.enum(["development", "test", "production"]).default("development"),
    ),
    APP_ENV: optionalWithDefault(
      z.enum(["development", "staging", "production"]).default("development"),
    ),
    PORT: optionalWithDefault(
      z.coerce.number().int().positive().default(10000),
    ),
    HOST: optionalWithDefault(z.string().default("0.0.0.0")),
    FIREBASE_PROJECT_ID: z.string().min(1).default("grounded-fruitful-local"),
    FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
    FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
    FIREBASE_STORAGE_BUCKET: z
      .string()
      .trim()
      .regex(
        /^(?=.{3,222}$)[a-z0-9][a-z0-9._-]*[a-z0-9]$/,
        "FIREBASE_STORAGE_BUCKET must be an exact Cloud Storage bucket name, not a URL.",
      )
      .optional(),
    ALLOWED_ORIGINS: z.string().default("http://localhost:4200"),
    CHILD_LOGIN_PEPPER: z
      .string()
      .min(16)
      .default("local-emulator-only-pepper"),
    CHILD_LOGIN_LOOKUP_SECRET: z
      .string()
      .min(16)
      .default("local-emulator-lookup-secret"),
    LOG_LEVEL: optionalWithDefault(
      z.enum(["debug", "info", "warn", "error"]).default("info"),
    ),
    PROGRAM_TIMEZONE: optionalWithDefault(z.string().default("UTC")),
    MEMBERSHIP_ENFORCEMENT_MODE: optionalWithDefault(
      z.enum(["compatibility", "strict"]).default("compatibility"),
    ),
    CHILD_CREDENTIAL_MIGRATION_MODE: optionalWithDefault(
      z.enum(["compatibility", "strict"]).default("compatibility"),
    ),
  })
  .superRefine((value, context) => {
    const explicitCredentials = [
      value.FIREBASE_CLIENT_EMAIL,
      value.FIREBASE_PRIVATE_KEY,
    ];
    if (
      explicitCredentials.some(Boolean) &&
      !explicitCredentials.every(Boolean)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be configured together.",
      });
    }
    if (value.CHILD_LOGIN_LOOKUP_SECRET === value.CHILD_LOGIN_PEPPER)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "CHILD_LOGIN_LOOKUP_SECRET must be distinct from CHILD_LOGIN_PEPPER.",
      });
    if (value.APP_ENV === "production") {
      for (const name of [
        "FIREBASE_PROJECT_ID",
        "FIREBASE_STORAGE_BUCKET",
        "ALLOWED_ORIGINS",
        "CHILD_LOGIN_PEPPER",
        "CHILD_LOGIN_LOOKUP_SECRET",
      ]) {
        if (!String(value[name as keyof typeof value] ?? "").trim())
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${name} is required in production.`,
          });
      }
      for (const name of [
        "FIREBASE_AUTH_EMULATOR_HOST",
        "FIREBASE_STORAGE_EMULATOR_HOST",
        "FIRESTORE_EMULATOR_HOST",
      ]) {
        if (process.env[name])
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${name} must not be set in production.`,
          });
      }
      if (!explicitCredentials.every(Boolean))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Explicit Firebase credentials are required in production.",
        });
    }
  });
export const env = firebaseEnvSchema.parse(process.env);
export const allowedOrigins = new Set(
  env.ALLOWED_ORIGINS.split(",")
    .map((v) => v.trim())
    .filter(Boolean),
);
