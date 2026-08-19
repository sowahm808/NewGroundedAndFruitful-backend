# Backend feature checklist

Audited against the repository on **2026-08-19**. A checked item is implemented
in executable code/configuration and, where practical, covered by an automated
test. Domain types, documentation, collection names, and placeholder test
scripts do **not** count as completed features.

## Implemented and verified

### Runtime and API foundation

- [x] Node.js 22, TypeScript, ESM, Express, and production build/start scripts.
- [x] Application/server separation with graceful `SIGTERM`/`SIGINT` shutdown.
- [x] Root, `/health`, and `/api/v1/health` health responses.
- [x] Versioned `/api/v1` routes, with a temporary legacy `/api/auth` alias.
- [x] Request IDs, structured JSON logging, centralized safe error envelopes,
      and production stack-trace suppression.
- [x] Helmet headers, allowlisted CORS, a 64 KiB JSON body limit, and global
      request throttling.
- [x] OpenAPI file and non-production-only documentation routes.
- [x] Multi-stage Docker image, Render service configuration, and CI checks for
      lint, types, unit tests, integration-test command, and build.

### Authentication and authorization

- [x] Firebase Admin initialization and revocation-aware bearer-token
      authentication.
- [x] Adult session bootstrap via `GET`/`POST /api/v1/auth/session`, including
      idempotent role-free user profile creation.
- [x] Canonical role resolution from server-controlled users/memberships rather
      than trusting token role claims.
- [x] Anonymous `POST /auth/child-token` via normalized family code/handle,
      Argon2 PIN hash, server pepper, constant-work generic failures, exactly
      one active child membership, enabled Firebase user, scoped custom-token
      claims, account lockout, and audit events.
- [x] Child-token-specific privacy-hashed process-local rate limiting with an
      integer `Retry-After` response.
- [x] Role-assignment service and guarded administrator CLI.
- [x] Relationship-aware participant summary read for the participant, linked
      parent, assigned mentor, and supported legacy administrative roles.

### Points and domain safeguards

- [x] Authenticated `POST /api/v1/points/completions` with Zod validation and a
      required, validated idempotency key.
- [x] Server-side point-rule lookup and positive safe-integer award validation.
- [x] Participant/team relationship authorization before an award.
- [x] Transactional append-only ledger writes plus participant-quarter,
      team-quarter, and team-week aggregate updates.
- [x] Exact-retry idempotency and rejection of conflicting key reuse.
- [x] Reserved administrator adjustments rejected from the public completion
      route.
- [x] Participation-only point inputs: clients cannot submit grades, ratings,
      correctness, or point amounts.
- [x] Character final-assessment validation and project state-transition domain
      validation (domain helpers only; full APIs remain unchecked below).

### Data protection and operations

- [x] Deny-by-default Firestore rules, with narrow self/relationship reads and
      no browser writes to authoritative records.
- [x] Deny-by-default Storage rules.
- [x] Firestore rules test cases exist for participant/team allow and deny
      behavior (making them reliable in CI remains unchecked below).
- [x] Production-guarded emulator seed script.
- [x] Environment validation that rejects emulator hosts and incomplete Firebase
      credentials in production.
- [x] Unit/API coverage for current authentication, authorization, child login,
      point domain, and point repository behavior.

## Launch blockers and cross-cutting work

Complete these before treating the backend as production-ready for the full
product. The order reflects dependencies and risk.

- [ ] Approve the organization/program tenancy contract, add `organizationId`
      and memberships consistently, and enforce tenant scope in services,
      records, indexes, ledger entries, aggregates, and rules.
- [ ] Build a non-destructive, checkpointed migration/backfill with invariant
      verification, dual-read rollout, rollback controls, and production
      monitoring.
- [ ] Replace predictable legacy relationship lookups with organization-scoped
      active/dated parent, mentor, and authorized-adult grants.
- [ ] Approve and migrate legacy `admin`, `super_admin`, and `observer` roles to
      the final product role vocabulary without locking out existing users.
- [~] Emulator-backed point transaction and concurrent-idempotency tests are
  mandatory and production access is guarded. Authentication/session,
  relationship, cross-tenant, and rollback integration coverage remains.
- [x] Compiled `lib/test` files are excluded, clean removes only the validated
      build output, and CI performs a second clean build.
- [x] Firestore rules tests are part of the CI-equivalent command.
- [!] Pin `firebase-tools` as a development dependency. The execution
  environment's registry returns HTTP 403 for this package; an approved
  exact version and generated lockfile are required before merge. Risk:
  emulator CI remains blocked until the infrastructure owner resolves it.
- [ ] Replace process-local rate limiting with a managed shared limiter before
      enabling horizontal scaling.
- [ ] Implement and test backend Firebase App Check token verification; current
      documentation/configuration intent is not executable enforcement.
- [ ] Add membership administration before exposing access removal. It must
      revoke Firebase refresh tokens in the same command path as suspension or
      deletion and emit an immutable audit event.
- [ ] Define program timezones, quarter lifecycle/state transitions, and week
      boundaries; stop deriving weekly aggregates solely from UTC Mondays.
- [ ] Persist point-rule identity/version and the evaluated rule snapshot on
      each ledger entry.
- [ ] Add aggregate reconciliation/rebuild jobs with dry-run, checkpoint,
      observability, and repair audit trails.
- [ ] Choose a production secrets manager/service-account injection strategy
      and document key rotation.
- [ ] Complete OpenAPI request/response/error schemas for every existing route
      and add contract tests.
- [ ] Decide whether a versioned response-envelope migration should add
      `success: true`; do not silently break current clients.

## Child journey integration audit (2026-08-19)

- [x] Authenticated, tenant- and participant-scoped dashboard/today summary, private check-in drafts and finalization, character cycles, Bible activities, reading reflections, projects, and sanitized team progress routes are implemented.
- [x] Private daily gratitude creation and cursor history are implemented without placing response text in URLs or queries.
- [x] Assigned special activities and surveys support server-scoped listing and idempotent final submissions; survey answers are validated against the published question IDs.
- [x] Child point-ledger history includes an authoritative calculation timestamp, and issued awards are participant scoped.
- [~] Private reading media upload remains intentionally disabled until the signed upload-target, scanning, finalization, cancellation, and private playback contract is approved.
- [~] Authenticated emulator E2E and deployment verification remain launch blockers; these checks do not assert that an external Render deployment matches this repository.

## Product feature roadmap

### Organizations, people, and consent

- [ ] Organization/program administration and membership APIs.
- [ ] Parent onboarding beyond automatic identity-profile provisioning.
- [ ] Participant creation, update, archival, and roster/list APIs.
- [ ] Team creation, assignment, membership, and lifecycle APIs.
- [ ] Mentor and authorized-adult invitation, approval, expiry, and revocation
      workflows.
- [ ] Consent capture, versioned consent history, withdrawal, and age/guardian
      policy enforcement.
- [ ] Administrative user/role/membership management with immutable audit
      events and least-privilege authorization.

### Program workflows

- [ ] Quarterly goals and a quarter open/lock/close state machine.
- [ ] Complete daily check-ins with source records, eligibility rules, edit
      windows, and one atomic source-completion/point-award transaction.
- [ ] Character reflection and assessment persistence/API (the validator alone
      is not a feature implementation).
- [ ] Bible activity delivery, response persistence, and completion API (the
      activity type and key helper alone are not an implementation).
- [ ] Observations with author, subject, visibility, moderation, and audit rules.
- [ ] Family activities and verified completion workflows.
- [ ] Reading activities, progress, and verified completion workflows.
- [ ] Project CRUD, mentor guidance, evidence, and transition endpoints (the
      transition helper alone is not a feature implementation).
- [ ] Academic-support activities and verified completion workflows.
- [ ] Special-activity definition, approval, and completion workflows.
- [x] Administrator point adjustment/reversal API with reason, original-entry
      linkage, authorization, and audit event.

### Engagement, reporting, and safety

- [ ] Surveys, response privacy, and reporting APIs.
- [ ] Awards/badges with deterministic eligibility and issuance history.
- [ ] Notification preferences, delivery jobs, retries, and redacted payloads.
- [ ] Participant, parent, mentor, team, and administrator dashboards.
- [ ] Privacy-reviewed leaderboards with tenant/team scope, tie behavior, and
      safe participant display names.
- [ ] Reports/exports with scoped authorization, asynchronous generation,
      expiry, and download audit logs.
- [ ] Design and review a restricted safeguarding/incident model, access audit,
      escalation workflow, and notification policy **before storing incident
      content**.
- [ ] Data retention schedules, automated enforcement, account deletion,
      guardian/participant privacy exports, legal holds, and deletion evidence.

## Definition of done for new features

Do not check a roadmap item merely because a schema, type, collection, or
documentation page exists. Check it only when all applicable work is complete:

- [ ] Product behavior, roles, tenant boundaries, privacy/retention, and failure
      behavior are approved.
- [ ] Validated HTTP contract and complete OpenAPI success/error documentation
      exist.
- [ ] Controller/route, service/domain authorization, and repository boundaries
      are implemented without trusting client-owned identity, role, award, or
      approval fields.
- [ ] Firestore indexes/rules and any migrations are deployed in a safe order
      with rollback and verification steps.
- [ ] Unit, API, emulator integration, cross-tenant allow/deny, idempotency, and
      concurrency tests exist as applicable and run in CI.
- [ ] Structured audit events, safe/redacted logs, metrics, alerts, and an
      operational recovery or reconciliation procedure exist.
- [ ] Documentation and seed/test fixtures are updated, and the feature has been
      exercised in staging with production-like configuration.

# Authorization policy decisions still requiring product approval

- Define a reviewed guardian-summary DTO/privacy policy before exposing any additional child content.
- Decide whether selected admin permissions may ever include membership, role, or audit management (the baseline does not).
- Define retention and review access for immutable authorization audit events.
- Add frontend route-guard and safe-return-URL work in the separate Angular repository; this repository contains no frontend application.
