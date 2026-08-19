# Backend production gap audit

## Scope and baseline

Audited on 2026-08-19. The existing Express/Firebase application exposed health, authentication/session, participant-detail, and point-completion endpoints. There was no Angular repository in this workspace to trace. The prior production paths contained no sample dashboard payload, but every parent feature contract was absent; the only previously documented hardcoded production behavior was an old 10-point completion path, already repaired to use configured server rules. Unit-test mocks and example email addresses are test-only.

The pre-change lint, typecheck, unit tests, and build passed. The integration command initially discovered stale compiled `lib/` tests and failed because no Firestore emulator was running; its exclusion was repaired. The integration script deliberately excludes Firestore Rules tests and currently has no other emulator tests, so it now reports no test files and exits successfully; this remains an important coverage gap.

## Implemented contracts and decisions

`/api/v1/parent` is authenticated and restricted to the canonical `parent` role. It now provides dashboard and child summaries, character-quality selection, observations, family activities/completions, academic-support categories/requests, child reports, and team progress. Empty reads return empty arrays/zeroes or explicit `notAvailable`; no examples are synthesized.

Identity comes only from the verified Firebase token. Roles and organization membership come from server-owned `users` and `memberships`. Parent access additionally requires a matching `parentChildLinks` record and matching participant organization. Search is applied after the linked-child set is established. Detail failures use a privacy-preserving not-found response. Point totals are summed from `pointLedger`; no point value is accepted by these APIs. Writes use transactions and server timestamps. Observation moderation starts at the persisted workflow state `pending`; safeguarding reports remain a separate product workflow and are never inferred from an observation.

Weekly calculations use `PROGRAM_TIMEZONE` (default `UTC`). Deployments must configure an IANA timezone appropriate to the program.

## Collections and fields

Required server-owned collections are: `users`, `memberships`, `participants`, `parentChildLinks`, `teams`, `teamMembers`, `quarters`, `participationActivities`, `participationCompletions`, `readingAssignments`, `readingResponses`, `projects`, `pointLedger`, `teamQuarterStats`, `characterQualities`, `characterSelections`, `characterObservations`, `familyActivities`, `familyActivityCompletions`, `supportCategories`, `supportRequests`, `notifications`, and `auditLogs`. See `firestore-model.md` for ownership and required fields. Composite indexes are declared in `firestore.indexes.json`.

## Authorization risks and mitigations

The Admin SDK bypasses Firestore Rules, so each service query checks principal UID, active server membership, relationship, and organization. Direct clients remain deny-by-default for nested/business collections. A global administrator path was not added. List pagination never accepts a UID or organization. Client-provided points, moderation state, status, week, quarter, ownership, and organization are ignored or rejected.

## Non-destructive migration

Before enabling the parent routes, backfill and validate (without deleting legacy data): canonical `users.roles`; active `memberships`; explicit `parentChildLinks`; participant/team/quarter organization IDs; approved display names; timestamp quarter bounds; active statuses for configurable libraries; and append-only ledger fields. Deploy indexes before traffic. Run a read-only orphan/cross-organization report, correct records through reviewed admin tooling, then enable the frontend. No migration runs automatically.

## Remaining product decisions

Define program week semantics beyond quarter-relative weeks; eligibility rules for participation and reading assignments; whether team targets vary per quarter; observation moderation transitions and safeguarding escalation; support assignee/note/closure role policies; notification lifecycle; character-selection edit windows; configured family-activity point rules; quarter-comparison methodology; and retention/redaction policies. Mentor/admin support transitions and closure are intentionally not exposed until those policies are approved. These portions are not claimed production-ready.

## Deployment and rollback

Set `PROGRAM_TIMEZONE`, deploy indexes, run emulator/unit verification, deploy the backend, smoke-test with accounts from two organizations, then enable frontend calls. Roll back the Render release and frontend flag if authorization or index errors appear; do not delete newly written documents. Existing API paths remain unchanged.
