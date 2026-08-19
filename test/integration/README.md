# Emulator integration tests

This directory contains mandatory tests executed with `firebase emulators:exec`.
`npm run test:rules` exercises browser allow/deny behavior and
`npm run test:integration` exercises Admin SDK transactions. Both commands
validate that the project is a `demo-*` project and that Firestore points to a
loopback emulator before importing application Firebase code. Vitest is given
an explicit test file, so a missing integration suite fails rather than passing
with zero discovered tests. Compiled `lib` files are excluded from discovery.

Auth/session emulator coverage requires both `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`. Run `npm run seed` only against the emulators, then `npm run test:integration`. Session fixtures use server-written `memberships` documents; token claims are deliberately non-authoritative.
