const project =
  process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID ?? "";
const environment = process.env.APP_ENV ?? "development";
if (
  environment === "production" ||
  (!project.startsWith("demo-") && project.includes("grounded-fruitful"))
) {
  throw new Error(
    "Destructive emulator/seed operations are forbidden for production projects.",
  );
}
if (
  process.argv.includes("--require-emulator") &&
  !process.env.FIRESTORE_EMULATOR_HOST
) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required for this operation.");
}
