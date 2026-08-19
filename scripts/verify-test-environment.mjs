const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";

if (!projectId.startsWith("demo-")) {
  throw new Error(
    "Integration tests require a Firebase demo project (FIREBASE_PROJECT_ID=demo-*).",
  );
}

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(firestoreHost)) {
  throw new Error(
    "Integration tests require a loopback FIRESTORE_EMULATOR_HOST.",
  );
}
