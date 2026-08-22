# Backend delivery report

Audit date: 2026-08-19. This report is an evidence-based release gate, not a production-readiness declaration.

## 1. Baseline findings

The authoritative `Grounded_Fruitful_Product_Flow_and_Contract_Final.docx` is not present and must be added to this repository (or supplied through an approved versioned product-authority process). The prompt, executable code, OpenAPI, audits, Firestore model, point-engine guide, comparison guide, and checklist were used instead.

Baseline commands were run before edits. `npm ci`, lint, typecheck, 381 unit/API tests, and build passed. The runner is Node 24.15.0 rather than the required Node 22 and emitted an engine warning. Integration and rules suites could not download exact `firebase-tools@14.12.1` because the registry returned HTTP 403. OpenAPI lint could not download Redocly for the same reason, `npm audit` received HTTP 403 from the advisory endpoint, and Docker is not installed. These are unverified gates, not passes.

Repository searches confirm mounted-but-undocumented routes, unchecked Firestore casts, process-local rate limiting, ad-hoc/document-ID cursors, and incomplete workflow tests. A passing compilation therefore does not establish safe tenant workflows.

## 2. Route implementation evidence

The method/path/authentication/role/membership/relationship/tenant/validation/OpenAPI/test/status inventory is maintained in [`route-inventory.md`](route-inventory.md). No new runtime route was implemented in this documentation correction. Current evidence supports auth, child, parent, participant, points, and bounded administration routers at varying completeness. Dedicated mentor and observer routers are absent. The generic completion endpoint must not be presented as source-specific completion.

## 3. Files changed in this audit correction

- `.env.example`: aligns the documented production credential variables with executable validation and Render configuration.
- `README.md`: replaces the stale small endpoint list and removes a false claim that OpenAPI is complete.
- `frontend-integration-handoff.md`: gives the separate frontend an explicit base URL, token/envelope contract, integration gates, fixture guidance, and known blockers.
- `rollback-runbook.md`: records a non-destructive application/data/rules/credential rollback procedure.
- This report records baseline and release-gate evidence.

## 4. Migrations required

No production migration was executed or authorized. Before strict enforcement, run the additive membership and child-credential migrations in staging with dry-run, bounded batches, checkpoints, collision/ambiguity reporting, count verification, audit evidence, and retained compatibility reads. Organization IDs, participant identity mappings, relationship dates/statuses, and any historical point-rule snapshots require separately reviewed backfills. Never edit ledger history.

## 5. Indexes and rules

No index or rules change was made in this correction. Existing rules remain deny-by-default. Deploy executable-query indexes before code and verify them in staging. Rules/emulator verification is still blocked in this runner, so the current files are not newly certified by this report.

## 6. Test results

| Command | Result |
|---|---|
| `npm ci` | pass; Node engine warning (runner 24.15.0, target 22) |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass: 17 files, 381 tests |
| `npm run test:integration` | blocked: registry HTTP 403 fetching firebase-tools |
| `npm run test:rules` | blocked: registry HTTP 403 fetching firebase-tools |
| `npx --yes @redocly/cli@1.34.5 lint openapi.yaml` | blocked: registry HTTP 403 |
| `npm run build` | pass |
| `npm audit --audit-level=high` | blocked: advisory endpoint HTTP 403 |
| `docker build -t grounded-fruitful-backend:audit .` | blocked: Docker executable unavailable |

## 7. Environment changes

Production requires distinct `CHILD_LOGIN_PEPPER` and `CHILD_LOGIN_LOOKUP_SECRET`, exact `ALLOWED_ORIGINS`, Firebase project/storage identifiers, and the paired `FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`. Secret values remain outside Git. Production rejects emulator hosts. A shared rate-limit adapter and approved App Check monitor/enforce/rollback contract remain absent.

## 8. Staging verification

No staging or production environment was accessed, migrated, or deployed. Required staging verification includes Node 22, all emulator/rules suites, two-tenant allow/deny cases, OpenAPI drift/schema validation, Docker smoke, membership ambiguity and migration reports, credential collision verification, source-award exact retry/conflict, revocation, signed-storage policy, and Render health/readiness behavior.

## 9. Deployment order

1. Approve/version the product contract and unresolved privacy/legal/provider policies.
2. Export and baseline staging, then production only after authorization.
3. Deploy additive indexes and restrictive rules; wait for index readiness.
4. Apply additive schemas and dry-run migrations in staging.
5. Verify counts/collisions, then run checkpointed staging migration.
6. Deploy backend in compatibility mode to one instance.
7. Run automated and manual two-tenant staging verification.
8. Complete and publish OpenAPI; hand it to the separate frontend repository.
9. Integrate behind frontend feature flags.
10. Gradually enforce strict membership and retain rollback flags through verification.

## 10. Rollback

Use [`rollback-runbook.md`](rollback-runbook.md). Roll back the Render revision and feature exposure without deleting additive records. Keep indexes where harmless, restore rules only if equally/more restrictive, retain migration checkpoints, and correct ledger errors exclusively through linked append-only adjustments/reversals.

## 11. Feature status

- [x] Runtime security baseline: Helmet, CORS allowlist, 64 KiB JSON limit, request IDs, safe envelopes/logging, graceful shutdown, health paths, non-root Docker definition, and production secret/emulator validation.
- [x] Revocation-aware Firebase authentication and membership-first canonical role resolution, with explicitly controlled no-membership compatibility fallback.
- [x] Deny-by-default browser rules and append-only transactional point repository primitives with exact-retry conflict protection.
- [~] Organizations, memberships, onboarding, participants, relationships, teams, child workflows, parent workflows, credentials, and administration: executable portions exist but OpenAPI, runtime persistence parsing, full lifecycle coverage, migrations, and cross-tenant emulator evidence are incomplete.
- [~] Point engine: participation safeguards and correction primitives exist; generic arbitrary-source completion remains mounted and source-specific atomic eligibility/snapshot coverage is incomplete.
- [~] Operations: Docker/Render definitions exist, but shared rate limiting, readiness dependency checks, App Check, metrics/alerts, and verified key rotation are incomplete.
- [ ] Dedicated mentor and observer journeys, quarter state machine, notification outbox, asynchronous reports/exports, aggregate rebuild/reconciliation, and complete OpenAPI drift enforcement.
- [!] Consent enforcement details, survey aggregation thresholds, special-activity approval, media scanning/provider flow, retention/deletion, safeguarding model/escalation, and horizontal-scaling failure policy require external approval. Safeguarding incident storage is deliberately absent.

## 12. Deliberately not implemented

No policy was invented for the 12-week quarter versus 8-week character cycle, guardian consent/legal effects, incident handling, survey privacy thresholds, special-activity approval, report retention, notification provider, media scanning, or shared rate-limit failure behavior. No fabricated endpoint/data, destructive migration, production migration, frontend edit, or deployment was performed. Full production readiness remains blocked.
