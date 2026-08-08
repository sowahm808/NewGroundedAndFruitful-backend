# Local development

Install Node 22 and Java. Run `npm install`, then `npm run emulators`. In a second shell export `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, and `FIREBASE_PROJECT_ID=grounded-fruitful-dev`; run `npm run seed`. The seed refuses to run without both emulator variables, preventing production writes.
