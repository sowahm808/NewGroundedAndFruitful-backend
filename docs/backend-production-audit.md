# Backend production audit

Audit date: 2026-08-19. This is a code and configuration audit, not a claim that every product workflow is implemented or production-ready.

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

There are no executable emulator integration tests. The integration script currently passes because `--passWithNoTests` is configured. There are no migrations, aggregate reconciliation jobs, export workflows, or quarter state machine. Program timezone handling and week boundaries are absent; weekly point aggregates currently use UTC Mondays. Point rules have no persisted rule ID/version snapshot, and ledger/aggregate records do not yet carry organization IDs. The generic completion endpoint does not validate an activity source record and therefore must not be considered a complete daily/activity workflow.

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
