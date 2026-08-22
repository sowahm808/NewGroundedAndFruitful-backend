# Production readiness audit — 2026-08-22

## Decision

**NO-GO. No deployment was performed.** The contract release gate fails: the
mounted router, `openapi.yaml`, and a versioned frontend operation artifact do
not agree. `npm run audit:contracts` is the repeatable gate. Supply the
frontend OpenAPI artifact with `FRONTEND_OPENAPI_PATH=/path/to/openapi.yaml`;
absence of that artifact is deliberately a failure, not an assumed pass.

At audit time the static inventory found 240 mounted method/path combinations
(including compatibility aliases and generated lifecycle routes), 83 published
OpenAPI operations, 135 mounted operations absent from OpenAPI, and no OpenAPI
operations without a matching mount. The JSON output names every operation and
its source file. Counts are evidence for this SHA only and must be regenerated
after route changes.

## Required-control findings

|   # | Control                                                                    | Result                      | Evidence / release action                                                                                                                                                                                                                                                                                                    |
| --: | -------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Inventory every mounted route                                              | **Automated, failing gate** | `scripts/audit-contracts.mjs` discovers literal Express registrations, compatibility mounts, health routes, array aliases, and generated quarter transitions. Its JSON `mounted` array is the authoritative machine inventory.                                                                                               |
|   2 | Compare router, OpenAPI, frontend                                          | **Fail**                    | OpenAPI drift exists and no frontend artifact was supplied. Do not infer frontend calls from backend source. Resolve every `undocumented` and `unmounted` entry, then rerun with `FRONTEND_OPENAPI_PATH`.                                                                                                                    |
|   3 | Authentication, membership, workspace, capability, relationship, lifecycle | **Partial**                 | Authentication is applied at protected mounts; individual services contain role/capability and relationship checks. There is no route-by-route full-stack proof covering all 240 combinations, expired/suspended memberships, selected workspace, resource lifecycle, and capability denial.                                 |
|   4 | Valid empty states return 200 collections                                  | **Partial**                 | Several list services return arrays, but no contract suite asserts every list route returns `200` plus an empty collection for a valid empty tenant.                                                                                                                                                                         |
|   5 | Stable error envelopes                                                     | **Partial**                 | Central middleware emits `{error:{code,message,requestId}}`; validation can add `fieldErrors`, and the limiter sets 429 behavior. There is not yet a published response-schema assertion for 401/403/404/409/422/429 and dependency 5xx on every operation.                                                                  |
|   6 | Command idempotency                                                        | **Fail**                    | Point and Bible-import paths have idempotency controls, but all POST/PUT/PATCH/DELETE commands do not share a required key/replay contract.                                                                                                                                                                                  |
|   7 | Transactions for dependent writes                                          | **Partial**                 | Transactional services exist, but the audit did not prove every dependent multi-document write is atomic. Each command needs emulator failure-injection coverage.                                                                                                                                                            |
|   8 | Firestore indexes                                                          | **Partial**                 | `firestore.indexes.json` declares composite indexes and removes indexing from private/free-text fields. Query-to-index coverage and deployed index readiness were not verified against a Firebase project.                                                                                                                   |
|   9 | Firebase Storage                                                           | **Partial**                 | Readiness reports the configured Bible import bucket and Storage rules are deny-by-default. No production bucket CORS/IAM/lifecycle/malware policy or signed-download smoke was verified.                                                                                                                                    |
|  10 | Cross-tenant denial                                                        | **Partial**                 | Rules and selected relationship integration tests cover denial, but there is no two-tenant allow/deny matrix for every frontend operation.                                                                                                                                                                                   |
|  11 | Exclude private child fields                                               | **Partial**                 | The OpenAPI verifier rejects Bible correctness fields and field index overrides cover sensitive text. Response serialization tests are not exhaustive for child PIN/credential data, private notes, correctness, and safeguarding fields.                                                                                    |
|  12 | Emulator, contract, concurrency, migration, rollback tests                 | **Partial**                 | Unit/API, Firestore rules, integration and concurrent point tests exist. There is no single passing production gate covering contract drift, all migrations in dry-run/apply/verify modes, injected partial failure, and rollback rehearsal.                                                                                 |
|  13 | Deterministic UI fixtures                                                  | **Partial**                 | `npm run seed` is emulator-only and deterministic, but it supplies only one organization plus a suspended child; it does not provide the required two-tenant, empty-state, every-persona, every-lifecycle, and private-field canary dataset for UI capture.                                                                  |
|  14 | Deploy only after comparison passes                                        | **Enforced operationally**  | The comparison currently fails, so deployment was intentionally not attempted. CI/deployment must add `npm run audit:contracts` with the frontend artifact before any deploy command.                                                                                                                                        |
|  15 | SHA, health/smoke, rollback                                                | **Not deployed**            | Candidate SHA is recorded by Git at release time; there is no deployed SHA or production smoke result to report. Follow `docs/rollback-runbook.md`: disable frontend exposure, revert to the previous Render revision, preserve additive records/indexes, and use append-only reversals rather than deleting ledger history. |

## Route groups requiring contract disposition

The largest undocumented surfaces are the `/administration` compatibility
namespace, administration organization/team/member/consent/invitation routes,
configuration, mentor, observer, notification, report, parent compatibility,
and reconciliation operations. The OpenAPI-only set must also be resolved;
an OpenAPI operation is not deployable evidence merely because a similar
service exists.

Compatibility aliases are intentionally included in the inventory because
they are externally reachable contracts. If they are not frontend contracts,
remove or explicitly deprecate them rather than excluding them from the audit.

## Mandatory release sequence

1. Export the frontend's generated operation document and commit/version it in
   the release process.
2. Reconcile router and OpenAPI drift; make `audit:contracts` pass.
3. Add a route-level authorization/envelope/empty-state matrix and two-tenant
   fixtures, including private-field canaries.
4. Run unit, type, lint, build, emulator/rules, concurrency, migration
   dry-run/apply/verify, failure-injection, and rollback-rehearsal suites on
   Node 22.
5. Deploy indexes and wait for readiness; verify Storage IAM, CORS, lifecycle,
   upload/download and denial behavior.
6. Deploy one backend revision, record its immutable SHA, and smoke health,
   authentication, one allowed workflow, cross-tenant denial, rate limiting,
   and dependency failure envelopes.
7. Enable frontend features gradually. Roll back the revision and feature flag
   on authorization, index, error-rate, or data-integrity regressions.

Passing unit tests alone does not override this no-go decision.

## Audit execution evidence

- `npm run lint`, `npm run typecheck`, `npm test` (30 files, 534 tests), and
  `npm run build` passed in the audit runner.
- `npm run audit:contracts` ran successfully as an audit and exited nonzero as
  designed because it found 135 undocumented mounted operations and no
  frontend artifact.
- `npm run test:rules` could not start because the environment's npm policy
  returned HTTP 403 for the pinned `firebase-tools@14.12.1`; consequently the
  chained integration suite was not run. This is an unverified gate, not a
  test pass.
- No production/staging credentials, Firebase project, Render service, or
  frontend repository were supplied. Migration, rollback, deployed-index,
  Storage, deployment, and remote health/smoke claims therefore remain
  intentionally unverified.
