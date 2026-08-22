# Product-flow capability and navigation handoff

## Regression cause

The server capability allowlist contained only six Admin grants. Of the menu
contract, only `admin.quarters.manage` and `admin.bible_content.manage` matched
the frontend's capability checks, which is why an Owner/Admin session rendered
only Quarters and Bible. The old broader menu was not evidence of authorization:
it was role-driven frontend behavior in a separate repository. This backend has
no `NAV_ITEMS`, `adminNavigation`, frontend routes, lazy components, or feature
flags.

Organization bootstrap also wrote only the legacy flattened
`roles: ["owner", "admin"]`. It now writes the three distinct membership fields:
`roles` (compatibility), `workspaceRoles: ["owner", "admin"]`, and
`personas: ["admin"]`. It does not write a platform role. Owner by itself grants
no operational capability.

`src/auth/capabilities.ts` is the single projection policy. Both the session
service and request authentication call it using only the active membership.
Consequently a capability from workspace A cannot survive after workspace B is
selected. A tenant `super_admin` active membership receives explicit Admin and
tenant-administration grants; a platform claim without active workspace scope
does not receive menu capabilities.

## Representative session projections

Production tokens and credentials were not supplied, so no production payload
was captured. The executable fixtures establish the following after-state (all
capabilities are omitted when the account is disabled):

| Assignment in active membership | `workspaceRoles`           | `personas`     | Projection                                                                    |
| ------------------------------- | -------------------------- | -------------- | ----------------------------------------------------------------------------- |
| Organization Owner/Admin        | owner, admin               | admin          | all `admin.*`; no `tenant.*`                                                  |
| Organization Admin              | admin                      | admin          | all `admin.*`; no `tenant.*`                                                  |
| Owner only                      | owner                      | none           | none                                                                          |
| Tenant Super Admin              | super_admin                | optional admin | all `admin.*` and explicit `tenant.*`                                         |
| Parent                          | member/owner as applicable | parent         | linked-child, observation, family, support, report, notification capabilities |
| Mentor                          | member                     | mentor         | assigned-team, summary, reading/project-guidance capabilities                 |
| Observer                        | member                     | observer       | granted-subject and own-observation capabilities                              |
| Child                           | member                     | child          | Today, Character, Bible, Reading, Project, Team and own reward capabilities   |

Resource relationships remain additional authorization conditions; their menu
capability never permits unlinked children, unassigned teams, ungranted subjects,
private responses, or another tenant's records.

## Admin contract matrix

Frontend routes and lazy component names must be supplied by the frontend
repository. `—` means that this backend has no production contract and the
frontend item must be **disabled** (if roadmap visibility is approved), never a
working-looking placeholder. Existing administration services still perform
tenant role/scope checks; the capabilities below are the stable session/menu
contract and must also be adopted by each frontend route guard.

| Label             | Suggested route            | Capability                     | Backend endpoint / OpenAPI contract                 | Status   |
| ----------------- | -------------------------- | ------------------------------ | --------------------------------------------------- | -------- |
| Dashboard         | `/admin`                   | `admin.dashboard.read`         | —                                                   | disabled |
| Participants      | `/admin/participants`      | `admin.participants.read`      | only `GET /api/v1/participants/{id}`; no list       | disabled |
| Teams             | `/admin/teams`             | `admin.teams.read`             | administration team endpoints                       | enabled  |
| Assignments       | `/admin/assignments`       | `admin.assignments.read`       | `GET /api/v1/admin/assignments`                     | enabled  |
| Quarters          | `/admin/quarters`          | `admin.quarters.read`          | `GET /api/v1/admin/quarters`                        | enabled  |
| Character         | `/admin/character`         | `admin.character_content.read` | character quality/cycle administration endpoints    | enabled  |
| Bible             | `/admin/bible`             | `admin.bible_content.read`     | Bible content/import administration endpoints       | enabled  |
| Family Activities | `/admin/family-activities` | `admin.family_activities.read` | `GET /api/v1/admin/family-activities`               | enabled  |
| Books             | `/admin/books`             | `admin.books.read`             | `GET /api/v1/admin/books` and reading assignments   | enabled  |
| Projects          | `/admin/projects`          | `admin.projects.read`          | child project workflow only; no Admin list contract | disabled |
| Surveys           | `/admin/surveys`           | `admin.surveys.read`           | `GET /api/v1/admin/surveys`                         | enabled  |
| Point Rules       | `/admin/point-rules`       | `admin.point_rules.read`       | `GET /api/v1/admin/point-rules`                     | enabled  |
| Reports           | `/admin/reports`           | `admin.reports.read`           | `/api/v1/reports`                                   | enabled  |
| Awards            | `/admin/awards`            | `admin.awards.read`            | child awards only; no Admin contract                | disabled |
| Audit summaries   | `/admin/audit`             | `admin.audit_summaries.read`   | no approved summary endpoint                        | disabled |

An item may be called enabled only after its frontend page verifies loading,
ready, empty, validation, forbidden, dependency-error/retry states and real API
data. That verification cannot be performed in this backend-only repository.

## Migration and operations

Run `npm run migrate:role-model -- --dry-run` first. The additive migration
copies governance roles into `workspaceRoles` and persona roles into `personas`,
adds the Admin persona for legacy Admin memberships, preserves the flattened
roles (including verified `super_admin`), and reports every proposed before and
after value. `--apply` updates each membership and writes an audit event. It
never infers Super Admin from Owner and never creates a platform claim.

Rollback must use the dry-run/apply report: restore each recorded `before`
value in a new audited operation. Application rollback is `git revert <sha>`;
capability projection changes take effect after the frontend refreshes the ID
token once when `tokenRefreshRequired` is true and reloads `/api/v1/auth/session`.
