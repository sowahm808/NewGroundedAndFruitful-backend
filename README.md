# Grounded & Fruitful backend

A Node.js 22, TypeScript, Express API hosted as one Render service. Firebase Admin is initialized once and supplies Authentication, Firestore, and Storage; this project does **not** deploy Cloud Functions.

## Architecture

`src/app.ts` owns the HTTP pipeline and `src/server.ts` owns process lifecycle. Domain modules separate routes, controllers, services, repositories, schemas, and models. Repositories are the only persistence boundary. Firebase bearer tokens are verified with revocation checks, and services authorize the verified principal against parent-child and mentor-team link documents.

The point ledger uses the idempotency key as its immutable document identity. A Firestore transaction creates the ledger row and updates participant-quarter, team-quarter, and team-week aggregates atomically. Point domain inputs intentionally omit ratings, correctness, and grades so participation—not performance—controls awards. Corrections are new `adjustment` entries rather than mutations.

## Endpoints

- `GET /health` and `GET /api/v1/health`
- `POST /api/v1/auth/child-login`
- `GET /api/v1/participants/:id`
- `POST /api/v1/points/completions`
- `GET /docs` and `GET /openapi.yaml` (documentation UI is disabled in production)

The complete request/response contract is in [openapi.yaml](openapi.yaml).

## Firestore collections

`users`, `participants`, `childCredentials`, `parentChildLinks`, `teams`, `teamMembers`, `pointRules`, `pointLedger`, `participantQuarterStats`, `teamQuarterStats`, `teamWeeklyStats`, and `auditLogs`. Browser rules default deny and forbid client writes to all authoritative collections.

## Local development

1. Install Node 22 and Java 21+, then run `npm ci`.
2. Copy `.env.example` to `.env`; use a `demo-*` Firebase project ID locally.
3. Run `npm run emulators`, then `npm run seed` in another terminal.
4. Run `npm run dev`. Never use production credentials with the emulator or seed scripts.

## Render deployment

Create distinct Firebase projects and Render environments for staging and production. Configure every variable listed in `.env.example` in Render; secrets must be secret environment values, never repository files. Set `ALLOWED_ORIGINS` to a comma-separated allowlist (for example the two production website origins), and set a random high-entropy `CHILD_LOGIN_PEPPER`. Render builds the multi-stage Docker image, runs compiled JavaScript, probes `/health`, and waits for required GitHub checks before automatic deployment. Grant the runtime service account only the required Firebase permissions.

## Security and privacy

Helmet, strict CORS, 64 KiB JSON limits, global and child-login rate limits, generic login failures, temporary child lockouts, Argon2 credential verification, request IDs, safe error envelopes, revocation-aware Firebase verification, and structured redacted event logs are enabled. Tokens, passwords, PINs, reflections, and wellbeing notes are never logged. Firestore and Storage rules deny browser writes by default; Admin SDK authorization is independently enforced by the API.

## Current scope and next steps

The production foundation and first authentication, participant, and point routes are implemented. The remaining named program domains require product-owned workflow contracts before their endpoints can be safely exposed. Before launch, add those contracts and emulator-backed relationship/concurrency/rules tests, use a managed shared rate-limit store for horizontal scaling, add aggregate-rebuild jobs, and wire a secrets manager/service-account injection strategy appropriate to the Render plan.
