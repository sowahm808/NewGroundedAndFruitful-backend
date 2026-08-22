# Production workflow route and contract restoration matrix

Audit date: 2026-08-22. Routes are relative to `/api/v1`. This matrix is a code audit of the routers mounted in `src/app.ts`, their service boundaries, Git history, `openapi.yaml`, and the product-flow baseline available in this checkout at `docs/reference/Grounded_Fruitful_Product_Flow_and_Contract_Final(2).docx`. The requested `(4)` artifact is not present in this checkout; no differences between revisions are assumed.

Status vocabulary: **working** means mounted with an executable service; **partial** means executable but a product/operations gate remains; **compatibility** means an intentional alias; **blocked** means policy in the baseline forbids claiming the workflow is complete.

| Product workflow | Mounted contract | Restoration / authorization result | OpenAPI state |
|---|---|---|---|
| Organization, session, onboarding | `/auth/session`, `/auth/registration`, `/auth/workspace`, `/auth/onboarding/*`; compatibility `/onboarding/*` | Working. Identity-only bootstrap remains separate from application authorization. Owners remain owners and receive no implicit operational or global authority. | Published |
| Participants and parent-child links | `/participants/:id`; `/admin/participants*`, `/admin/parent-onboarding`, `/admin/consents*` (also `/administration`) | Working/partial. Participant reads and administration services repeat organization and relationship policy. | Published representative contracts; administration compatibility surface is not duplicated |
| Teams and assignments | `/admin/teams*`; `/mentor/teams*`; `/child/team` | Working. Restored in historical commit `8fe8b06`; assigned-team services remain tenant scoped. | Published |
| Quarters | `/admin/quarters*`, `/configuration/programs/*/quarters/*` | Working. Lifecycle and overlap policy restored in `bac4ca3` and `19eb565`. | Published and verifier-gated |
| Character content | `/admin/character-qualities*`, `/parent/character*`, `/child/character*` | Working/partial. Child records remain private and parent access stays relationship scoped. | Published child and admin contracts |
| Bible content, import, review | `/admin/bible-content*`, `/child/bible*` | Working. Atomic import, DOCX reconciliation, Storage, validation/review and publish lifecycle from `16ac1e1`, `6e328af`, and `f3f6bba` are preserved. | Published and verifier-gated |
| Books and reading | `/admin/books*`, `/mentor/reading*`, `/child/reading*` | Working/partial. Assignment and child ownership checks remain in service boundaries. | Published |
| Family activities | `/admin/family-activities*`, `/parent/family-activities`, `/parent/family/activities`, completion command | Partial. List/detail scopes work; award completion remains policy gated unless it creates an eligible source completion and point snapshot. | Published |
| Projects | `/admin/project-templates*`, `/mentor/projects*`, `/child/projects*` | Working/partial. Child ownership, mentor assignment and lifecycle validation remain required. | Published |
| Surveys | `/admin/surveys*`, `/child/surveys*` | Working/partial. Responses remain private; aggregation-threshold policy remains a reporting gate. | Published |
| Point rules and ledger | `/admin/point-rules*`, `/points/sources/*/completions`, `/points/adjustments`, `/points/reconciliations*` | Working/partial. Amounts remain server selected, entries append-only, commands idempotent, and reconciliation reversible. | Published |
| Reports | `/reports/exports*`, `/parent/reports*`, admin report reads | Working/partial. Relationship and tenant checks are enforced; export provider/retention policy remains operationally gated. | Published |
| Awards and recognition | `/admin/awards*`, `/child/awards` | Working/partial. Recognition remains server-owned and quarter scoped. | Published |
| Audit | `/admin/audit-logs` and service-level audit writes | Working/partial. Tenant audit reads require tenant administration capability; safeguarding/retention decisions remain blocked. | Published |
| Child daily flow | `/child/today`, `/check-ins/today*`, `/gratitude`, `/character*`, `/bible*` | Working/partial. Canonical legacy `child` memberships now project the child persona/capabilities without broad authority. Atomic award requirements still apply per source. | Published |
| Parent workflows | `/parent/dashboard`, `/children*`, `/observations*`, `/family*`, `/academic-support*`, `/reports*`, `/notifications` | Working/partial. Canonical legacy `parent` memberships now project parent capabilities. Every child-specific service retains active-link and organization checks. | Published |
| Mentor workflows | `/mentor/teams*`, `/mentor/participants*`, `/mentor/reading*`, `/mentor/projects*`, `/mentor/observations*` | Working/partial. Router is mounted; canonical legacy `mentor` membership projection is restored. Assignment expiry and private-field exclusions remain enforced. | Published |
| Observer workflows | `/observer/subjects`, `/observer/observations*` | Working/partial. Router is mounted; canonical legacy `observer` membership projection is restored. Dated grants and own-submission scope remain enforced. | Published |

## Git comparison and disconnected authorization finding

The executable workflow routers were introduced in the history rather than removed: child workflows in `3a26e8c`, parent workflows in `4db1aa1`/`7a212aa`, administration in `0b3f458`, program/quarter configuration in `bac4ca3`, mentor/observer administration in `8fe8b06`, and reports/notifications in `eccbdf4`. `src/app.ts` mounts all of those routers, including both `/admin` and the retained `/administration` compatibility namespace. No safe historical endpoint was found in those commits that is implemented but currently unmounted.

The verified authorization disconnect was the persona migration boundary: memberships created before the `personas` field stored `child`, `parent`, `mentor`, or `observer` only in canonical membership roles. Capability middleware subsequently required persona-derived capabilities, producing 403 responses despite a valid active membership. Persona resolution now merges only exact canonical persona roles with explicit personas. It deliberately does **not** infer a persona from `owner`, does not infer `super_admin`, and does not add wildcard capabilities.

## Release evidence and limits

`openapi:generate` validates the required published operations and regenerates `src/generated/quarter-contract.ts`. The unit/API suite exercises role projection, relationship policy, cross-tenant denial, lifecycle schemas, point idempotency/conflicts, privacy exclusions, and storage/import behavior. Firebase emulator suites remain the authoritative integration gate for Firestore transaction and rules behavior and must be run in the deployment environment. This audit did not deploy; the deployed SHA is therefore **not applicable**. The source commit SHA is recorded in the delivery report after merge/deployment rather than fabricated here.
