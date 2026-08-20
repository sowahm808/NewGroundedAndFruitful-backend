# Parent journey API

All Phase 8 routes are under `/api/v1/parent`, require an authenticated `parent`
role, and return private, non-cacheable responses. Any operation concerning a
child verifies an **active** `parentChildLinks` record and requires the link,
participant, and authenticated membership to name the same organization.
Unauthorized and cross-tenant resources are not disclosed.

## Routes

| Method      | Path                                          | Contract                                                                                                                        |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| GET         | `/dashboard`                                  | Linked-child summary with a server `calculatedAt`.                                                                              |
| GET         | `/children`                                   | `limit` (1–50), opaque `cursor`, allowlisted `status`, and bounded `search`.                                                    |
| GET         | `/children/{childId}`                         | Approved summary fields only.                                                                                                   |
| GET / PATCH | `/character`                                  | Requires `childId` and `quarterId`; PATCH supplies five unique `qualityIds` and `expectedVersion`. A stale version returns 409. |
| GET / POST  | `/observations`                               | Bounded list and constructive positive-observation submission. POST requires `Idempotency-Key`.                                 |
| GET         | `/family/activities`                          | Requires `childId`; supports bounded cursor pagination and title search.                                                        |
| POST        | `/family/activities/{activityId}/completions` | Requires `childId` and `Idempotency-Key`; the activity/child completion identity makes retries exact.                           |
| GET         | `/academic-support/configuration`             | Active categories in the parent's organizations.                                                                                |
| GET / POST  | `/academic-support/requests`                  | Relationship-scoped bounded list; POST requires `Idempotency-Key`.                                                              |
| GET         | `/reports`                                    | Requires `childId`; returns explicit `notAvailable` states and `calculatedAt`.                                                  |

Lists are deterministically ordered and return `meta.nextCursor: null` when
there is no next page. Missing source data is represented by empty arrays,
zero counts, `null`, or an explicit `notAvailable`; the API never invents sample
records.

## Authority and privacy boundaries

Parents cannot set point amounts, moderate observations, mutate a child's
finalized submissions, or transition an academic-support request to closed.
This API exposes only approved display and progress fields, not private child
reflections or unrestricted notes. Observation text is for constructive,
positive recognition and must not be used for safeguarding or incident reports.

Creating an observation never writes to the point ledger. A separate authorized
moderation workflow may approve it and create at most one deterministic,
auditable bonus award under a server-owned rule; that moderation workflow is not
part of the parent API.
