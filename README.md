# Grounded & Fruitful backend

A Node.js 22, TypeScript, Express API hosted as one Render service. Firebase Admin is initialized once and supplies Authentication, Firestore, and Storage; this project does **not** deploy Cloud Functions.

## Architecture

`src/app.ts` owns the HTTP pipeline and `src/server.ts` owns process lifecycle. Domain modules separate routes, controllers, services, repositories, schemas, and models. Repositories are the only persistence boundary. Firebase bearer tokens are verified with revocation checks, and services authorize the verified principal against parent-child and mentor-team link documents.

The point ledger uses a validated idempotency key as its immutable document identity. An exact retry returns the existing result, while reuse for another source or owner is rejected. A Firestore transaction creates the ledger row and updates participant-quarter, team-quarter, and team-week aggregates atomically. Configured rules must award positive whole points. Point domain inputs intentionally omit ratings, correctness, and grades so participation—not performance—controls awards. The public completion route cannot create adjustments.

## Endpoints

- `GET /health` and `GET /api/v1/health`
- `/api/v1/auth` session and child-token operations
- `/api/v1/child` private child journeys
- `/api/v1/parent` relationship-scoped parent journeys
- `/api/v1/participants` participant summaries
- `/api/v1/points` completions and administrative corrections
- `/api/v1/administration` bounded tenant administration operations
- `GET /docs` and `GET /openapi.yaml` (documentation UI is disabled in production)

The currently published request/response contract is in [openapi.yaml](openapi.yaml).
It is incomplete: administration and several parent compatibility routes are
missing, and automated route drift enforcement remains a launch blocker. Use
the [route inventory](docs/route-inventory.md) as the operational route list and
the [frontend handoff](docs/frontend-integration-handoff.md) for integration
gates.

## Client authentication flow

Child users do not sign in through Firebase email/password. A browser call to Firebase Auth's `accounts:signInWithPassword` REST endpoint will return a Firebase `400 Bad Request` whenever the supplied value is not an enabled Firebase email/password account, the password is wrong, or the API key/project does not match the account. For child access, call this backend instead:

```http
POST /api/v1/auth/child-token
Content-Type: application/json

{ "familyCode": "...", "handle": "...", "pin": "..." }
```

The response is `{ "data": { "customToken": "..." } }`. The web client must exchange that custom token with Firebase Auth using `signInWithCustomToken`, then send the resulting Firebase ID token as `Authorization: Bearer <idToken>` to `GET /api/v1/auth/session` and protected API routes.

`/auth/child-token` accepts only the provisioned child-credential format shown
above: `familyCode` is 8–24 characters, `handle` is 2–24 characters, and `pin`
is a **six-digit string** (including any leading zero). Do not send the PIN as a
JSON number or under a `password` property; either produces a `422
VALIDATION_ERROR`. The parent-managed participant credential flow, which uses a
4–6 digit PIN, signs in through `POST /api/v1/auth/child-login` instead.

## Firestore collections

`users`, `participants`, `childCredentials`, `parentChildLinks`, `teams`, `teamMembers`, `pointRules`, `pointLedger`, `participantQuarterStats`, `teamQuarterStats`, `teamWeeklyStats`, and `auditLogs`. Browser rules default deny and forbid client writes to all authoritative collections.

## Local development

1. Install Node 22 and Java 21+, then run `npm ci`.
2. Copy `.env.example` to `.env`; use a `demo-*` Firebase project ID locally.
3. Run `npm run emulators`, then `npm run seed` in another terminal.
4. Run `npm run dev`. Never use production credentials with the emulator or seed scripts.

The seed supplies linked, empty, suspended, cross-tenant, and every-persona workflow scenarios. See [the emulator seed guide](docs/emulator-seed.md) for emulator-only sign-in details and privacy canaries.

## Render deployment

Create distinct Firebase projects and Render environments for staging and production. Configure every variable listed in `.env.example` in Render; secrets must be secret environment values, never repository files. `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` are required together in production. Set `ALLOWED_ORIGINS` to a comma-separated allowlist and generate independent high-entropy values for `CHILD_LOGIN_PEPPER` and `CHILD_LOGIN_LOOKUP_SECRET`. Render builds the multi-stage Docker image, runs compiled JavaScript, probes `/health`, and waits for required GitHub checks before automatic deployment. Grant the runtime service account only the required Firebase permissions.

`MEMBERSHIP_ENFORCEMENT_MODE=compatibility` is the deliberate migration-period setting. It prefers active memberships and uses server-controlled `users/{uid}.roles` only when no membership document exists. Set `strict` only after the membership verification command reports complete role and organization coverage; any other value fails startup validation.

## Security and privacy

Helmet, strict CORS, 64 KiB JSON limits, global and child-token rate limits, generic login failures, temporary child lockouts, Argon2 credential verification, request IDs, safe error envelopes, revocation-aware Firebase verification, and structured redacted event logs are enabled. Tokens, passwords, PINs, reflections, and wellbeing notes are never logged. Firestore and Storage rules deny browser writes by default; Admin SDK authorization is independently enforced by the API.

## Current scope and next steps

This is not the complete product backend: see [the production audit](docs/backend-production-audit.md) and [delivery report](docs/backend-delivery-report.md) for confirmed gaps and launch blockers. Do not enable a workflow merely because its route is mounted. Generic point completion, incomplete OpenAPI coverage, missing mentor/observer routers, process-local throttling, incomplete runtime persistence parsing, and missing policy decisions prevent a full production-readiness claim.
