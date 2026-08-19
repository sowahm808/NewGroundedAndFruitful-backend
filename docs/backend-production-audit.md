# Backend production audit

Audit date: 2026-08-19. This is a code and configuration audit, not a claim that every product workflow is implemented or production-ready.

> Current evidence note: the older “Missing or incomplete features” narrative below records the repository's earlier audit stage and is retained as remediation history. The authoritative mounted-route state is now `route-inventory.md`; frontend differences are in `frontend-backend-contract-comparison.md`.

## Current production classification

- [x] Firebase ID tokens are checked with revocation enabled; active membership records are the normal role source, and an inactive/malformed membership prevents legacy fallback.
- [x] Canonical roles are `child`, `parent`, `mentor`, `observer`, `admin`, and `super_admin`.
- [x] Firestore and Storage remain deny-by-default for browser domain access; Admin SDK services must authorize independently.
- [x] JSON is limited to 64 KiB, origins are allowlisted, Helmet and request IDs are enabled, errors are centrally sanitized, and private APIs use `no-store`.
- [~] Parent and child APIs are mounted, but runtime Firestore parsing, opaque datastore cursors, index-backed bounded list queries, and complete emulator/API authorization coverage are incomplete.
- [~] Parent child/detail, observation, support, report, and dashboard reads now require active relationships where child data is returned. Relationship scans are bounded, but production cardinality policy and cursor redesign remain required.
- [ ] Mentor and observer routers are not mounted. The administration router exists at `/administration`, not the historical `/admin` path.
- [ ] OpenAPI drift enforcement is absent. The specification documents most child routes but omits mounted administration and parent character/detail routes.
- [!] The proposed parent character preference resource is blocked until product owners define ownership, mutability, quarter windows, and version semantics.
- [!] Family-activity award completion is blocked: the mounted legacy completion does not atomically create a source completion and immutable point-rule/version snapshot. Do not connect the proposed Angular command to it.
- [!] Safeguarding intake, academic-support closure authority, report exports/download audit, retention/deletion, and App Check enforcement require product/privacy/legal/infrastructure decisions.
- [!] Rate limiting is process-local. Production must remain a single instance until a managed shared-store adapter, deployment mode, and failure policy are implemented and tested.

## Baseline and verification evidence

Before the current corrections, `npm ci`, lint, typecheck, 381 unit/API tests, and the production TypeScript build passed. The runner used Node 24.15.0 and emitted an engine warning because the repository intentionally targets Node 22; CI, Docker, `package.json`, and Render otherwise agree on Node 22. Rules/emulator and Docker checks were not part of that baseline command. An attempt to pin `firebase-tools@14.12.1` as a dev dependency received registry HTTP 403, so mandatory scripts retain their exact-version `npx` invocation rather than pretending the dependency was installed.

The baseline exposed material evidence gaps: API tests mostly prove unauthenticated denial, broad child/admin workflows lack emulator tests, OpenAPI has no drift test, and several Firestore services use unchecked casts. Passing tests are not treated as production readiness.

## Deployment, migration, and rollback

No production migration or deployment was run. Membership and child-credential migration scripts are additive/dry-run capable, but no new data migration is required by the active-link and envelope corrections. Before release: export Firestore, establish baseline denial/error metrics, deploy only query-backed indexes, run migrations in staging dry-run mode, inspect collisions/ambiguities, run emulator/rules/API suites with two tenants, deploy in membership compatibility mode to one instance, and smoke-test before frontend enablement. Move to strict membership enforcement only after reconciliation.

Rollback is a Render release rollback plus restoration of the prior frontend feature flag; do not delete observations, requests, completions, ledger entries, memberships, or audit events. Retain `MEMBERSHIP_ENFORCEMENT_MODE=compatibility` until active membership counts and ambiguity reports are approved. If authorization or index errors rise, disable the affected frontend workflow, roll back application code, and preserve additive documents for reconciliation.

Required production environment is documented in `.env.example`: Firebase project/storage and explicit credentials, exact allowed origins, independent child-login pepper and lookup secret, application/node environment, membership mode, and an IANA `PROGRAM_TIMEZONE`. Emulator variables are forbidden in production. No App Check variable exists because monitor/enforce/exemption/rollback behavior has not been designed.

## Current architecture

The repository is a Node 22 ESM Express service compiled by TypeScript to `lib/src/server.js`. `src/app.ts` defines the middleware and versioned routes; `src/server.ts` owns lifecycle and graceful shutdown. Firebase Admin supplies Authentication, Firestore, and Storage. Existing feature modules generally separate routes, controllers/services, repositories, and Zod schemas, although the points route previously bypassed its domain service. Browser Firestore and Storage access is deny-by-default except for narrowly scoped self/linked-parent reads.

HTTP controls currently include Firebase bearer-token verification with revocation checks, Helmet, an environment allowlisted CORS policy, a 64 KiB JSON limit, request IDs, safe centralized errors, JSON event logs, and in-memory rate limiting. The in-memory limiter is not suitable as the sole production control when more than one instance is running.

## Existing features confirmed

- Adult Firebase session bootstrap and conservative parent self-provisioning.
- Anonymous child family-code/handle/PIN exchange at `POST /api/v1/auth/child-token`, backed by normalized identifiers, Argon2 hashes, a server pepper, constant-work generic failures, privacy-hashed throttling, lockout, audit records, enabled-user and unique-active-membership checks, and scoped Firebase custom tokens. Argon2 exists only for this child credential bridge; Firebase remains authoritative for sessions.
- Relationship-aware participant summary reads for a child, linked parent, assigned mentor, and legacy administrators.
- A transactional append-only points ledger with participant/team aggregates and exact-retry idempotency.
- Participation-only point domain rules, five-item character reflection validation, and project transition validation.
- Deny-by-default Firestore/Storage rules, production-guarded seed command, health endpoints, graceful shutdown, CI, Docker, and Render configuration.

## Missing or incomplete features

Only auth session/child login, participant summary, and completion award endpoints are published. Parent onboarding beyond user provisioning, organizations/memberships, consent, teams APIs, quarterly goals, complete daily check-ins, observations, family activities, reading, project APIs, academic support, special activities, surveys/reporting, awards, notifications, dashboards, leaderboards, incidents, retention/deletion, and administrative workflows are not implemented. Domain types or collection names in documentation are not implementations.

An explicit Admin SDK Firestore-emulator suite now verifies atomic point writes and concurrent idempotency. A pre-import guard rejects non-demo projects and non-loopback Firestore hosts; zero-test success and stale compiled-test discovery were removed; the CI-equivalent command includes rules and a second clean build. Execution remains blocked until the registry permits an exact `firebase-tools` dependency and lockfile update. There are no migrations, aggregate reconciliation jobs, export workflows, or quarter state machine. Program timezone handling and week boundaries are absent; weekly point aggregates currently use UTC Mondays. Point rules have no persisted rule ID/version snapshot, and ledger/aggregate records do not yet carry organization IDs. The generic completion endpoint does not validate an activity source record and therefore must not be considered a complete daily/activity workflow.

## Security and data-integrity risks

### Addressed in this change

- The public completion route bypassed `CompletionService`, trusted a hardcoded 10-point amount, and skipped participant/team relationships and configured rules. It now uses the service and server-side point rules.
- A caller could reuse an idempotency key belonging to a different award and receive limited information from that ledger entry. Repository retries now compare immutable ownership/source fields and reject conflicting reuse.
- Completion input accepted the reserved `adjustment` type. Adjustments are now rejected from this route and remain reserved for a future administrator reversal workflow.
- Invalid negative or fractional configured awards could affect aggregates. Domain evaluation now permits positive safe integers only.
- Direct Firestore team reads exposed every team to every signed-in user, and elevated claims bypassed organization checks. Team and elevated direct reads are now denied; those future operations must go through relationship-aware API services. Parent links must be active and internally consistent.

### Remaining

- Organization isolation is not represented consistently in existing records and cannot be safely inferred. Production multi-tenant use is blocked until a product-approved migration backfills `organizationId`, memberships, and scoped indexes, with rollback and verification.
- Clients can request a completion against a source ID that is not currently verified against a completed source record. Until source-specific transactional workflows exist, access to this endpoint should be restricted operationally; it is not a substitute for daily check-in completion.
- Parent and mentor relationship helpers use predictable legacy document IDs and do not validate organization, active status, or validity dates. API administrative roles are legacy `admin`/`super_admin`, while the requested product vocabulary is `administrator`/`authorizedAdult`; renaming claims without a migration would lock out existing users.
- Point award and source completion are not in one transaction. Aggregate week calculation is UTC rather than program-timezone based. No reversal API/audit event exists.
- Child-login throttling is process-local by IP plus account lock state; use a managed distributed limiter before horizontal scaling. Audit writes in login paths can make authentication unavailable when audit storage is unavailable, which is secure but needs monitoring.
- Incident content/access audit, retention enforcement, consent history, privacy exports, and notification redaction do not exist. Do not store or process safeguarding incidents until the dedicated restricted design is implemented.

## API compatibility

Existing paths and the `{ data: ... }` / `{ error: ... }` envelopes are retained. `POST /api/v1/points/completions` now rejects malformed idempotency keys, the reserved `adjustment` source, unauthorized relationships, missing/ineligible configured point rules, and idempotency collisions. These are intentional security corrections. The OpenAPI contract remains incomplete about response bodies and does not document the missing feature routes.

The requested success envelope includes `success: true`, but adding it globally could affect the current frontend. A versioned compatibility plan is required before changing existing envelopes.

## Assumptions

- Existing production claims and records may use `admin`, `super_admin`, and `observer`; they must be migrated rather than silently renamed.
- Admin SDK access is the intended persistence boundary. Browser SDK writes are not required for existing APIs.
- Product owners must define organizations, program membership, consent/legal retention, authorized-adult grants, moderation, incident response, quarter transitions, and source-specific completion criteria before those workflows are exposed.
- Existing ledger entries and aggregates are immutable operational records; no destructive backfill is authorized by this audit.

## Implementation decisions and rollout

This change applies only unambiguous hardening and does not invent product behavior. Deploy Firestore rules before exposing new client collections. Existing point-rule documents must contain `points` as a positive integer, `enabled`, and Firestore `effectiveFrom`; malformed rules become ineligible. Monitor `CONFLICT`, `FORBIDDEN`, and `POINT_RULE_INELIGIBLE` responses after rollout.

Next, approve a non-destructive organization migration: add organization/program membership records, dual-read old and new fields, backfill in batches with checkpoints, verify counts and relationship invariants, deploy organization-scoped indexes, switch reads, and retain a rollback flag until validation completes. Then implement source-specific services that atomically create the completion and ledger award. Do not launch multi-tenant, leaderboard, safeguarding, or privacy-export features before their policies and emulator allow/deny tests are reviewed.
