# Emulator integration tests

This directory is reserved for tests executed with `firebase emulators:exec`. The production rules and transaction repository are exercised against the Emulator Suite in CI as the API surface expands.

Auth/session emulator coverage requires both `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`. Run `npm run seed` only against the emulators, then `npm run test:integration`. Session fixtures use server-written `memberships` documents; token claims are deliberately non-authoritative.
