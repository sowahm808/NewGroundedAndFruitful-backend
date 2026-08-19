# Backend implementation plan

Updated 2026-08-19. Status is evidence-based: `[x]` verified, `[~]` partial,
`[ ]` absent, and `[!]` blocked by an explicit external decision.

## Dependency-safe delivery map

| Increment                    | Required behavior and API                                                                   | Data, authorization, privacy, migration, tests, and operations                                                         | Status                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Testing foundation           | Mandatory unit, rules, and Admin SDK suites; clean build                                    | Demo/loopback guard; deterministic emulator commands; explicit discovery; rules in CI; safe `lib` cleanup              | [~] Implemented here; Firebase CLI pin blocked by registry policy |
| Tenancy/migration            | Organization, program, membership, relationship, assignment, and grant policies             | Tenant scope begins in repositories; additive bounded checkpoints, ambiguity report, dual-read rollback; indexes first | [ ] Contract approval required                                    |
| Time/quarters                | IANA program dates and draft→scheduled→open→checkpoint→closed→recognition→archived commands | Scoped audited transitions; local-week additive backfill; idempotency tests                                            | [ ] Product locking policy required                               |
| Ledger                       | Versioned rule snapshots, atomic source completion, adjustment/reversal, reconciliation     | Server points; linked compensation; additive migration; rebuild checkpoints/audits/metrics                             | [ ] Depends on tenancy/quarters                                   |
| Parent/child                 | Requested dashboards, records, activities, reading, projects, and sanitized team APIs       | Active relationship/ownership/consent, tenant scope, private responses, cursor allowlists, source transactions         | [~] Parent subset exists; requested contracts remain incomplete   |
| Mentor/observer              | Assigned teams/work and scoped moderated observations                                       | Active dated assignment/grant; minimum data; no incident content; rate/audit/revocation tests                          | [ ] Policy and tenancy dependencies                               |
| Administration               | Bounded CRUD/lifecycle and dashboard for listed resources                                   | Least privilege, versions, archival, final-super-admin protection, immutable audits, indexes/contracts                 | [ ] Depends on tenancy/lifecycle decisions                        |
| Consent/onboarding           | Versioned acceptance/withdrawal, linking, enrollment                                        | Participation blocking, guardian verification, audit                                                                   | [!] Legal text, age, retention, and withdrawal decisions required |
| Surveys/awards/notifications | Targeted surveys, deterministic awards, provider-neutral outbox                             | Minimization/thresholds; redaction; idempotency/retry/monitoring                                                       | [!] Privacy threshold/provider undecided                          |
| Dashboards/reports           | Real scoped summaries, team-only leaderboard, asynchronous exports                          | Honest empty states; no child ranking; redaction, expiry, download audit                                               | [!] Depends on sources and privacy/export decisions               |
| Safeguarding/retention       | Restricted boundary only; configured holds/deletion/export infrastructure                   | Ordinary observations never store incidents; dry-run/evidence/recovery/denial tests                                    | [!] Safeguarding/legal review required                            |
| App Check/operations         | Monitor/enforce modes, limiter adapter, readiness/safe metrics                              | Exemptions; unsafe horizontal startup failure; managed provider and secret rotation runbook                            | [!] Providers not provisioned                                     |
| Rules/OpenAPI                | Complete schemas, drift tests, deny-by-default evaluation per endpoint                      | Cross-tenant/rules/staging/rollback verification and no sensitive logs                                                 | [~] Existing routes/rules only                                    |

No incomplete route is published merely to replace an unavailable frontend
state. Completion requires schema, route, policy, tenant-scoped repository,
indexes/rules evaluation, audit, OpenAPI, automated tests, staging evidence, and
rollback instructions.
# Child workflow status (2026-08-19)

- [~] Partial — centralized child context, membership, participant mapping, tenant scope, active-quarter overlap protection, and local-date handling.
- [~] Partial — Today, check-in, character, Bible, reading, project, and privacy-safe team API routes, contracts, services, indexes, server-only rules, OpenAPI, and tests.
- [~] Partial — transactional participation-rule snapshots and deterministic idempotency for completion workflows.
- [~] Partial — finalized records are immutable; a richer configurable edit/lock policy awaits product definition.
- [!] Blocked — staging smoke verification requires deployed authenticated child fixtures.
