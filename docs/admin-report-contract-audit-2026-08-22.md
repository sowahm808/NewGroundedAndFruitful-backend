# Admin list/report contract audit — 2026-08-22

## Incident evidence and exact causes

Request `451730ef-9d39-4f46-9e38-f648686f0133` is not present in the repository and this checkout has no Render/log-provider credentials or CLI. Production log correlation and production replay therefore remain unverified; no log-derived claim or deployed SHA is fabricated.

The source audit identified three deterministic causes matching the reported responses:

1. **404:** the Admin UI contract was not mounted. Report operations existed only at `/api/v1/reports`; `/api/v1/admin/reports` was handled by the generic Administration router, whose `/reports` endpoint read the unrelated `reports` collection and had no definitions/jobs/detail routes.
2. **422:** there was no validated Admin report-list query. Generic Admin lists accept `sort=updatedAt|-updatedAt`, while report jobs now intentionally accept only `createdAt|-createdAt`; definitions accept `name|-name|updatedAt|-updatedAt`. Invalid and unknown parameters return `VALIDATION_ERROR` with `fieldErrors`.
3. **403:** report authorization was role/organization-array based rather than the Admin session capability plus active membership/workspace contract. Admin report operations now require the projected `admin.reports.read` or `admin.reports.manage` capability, an active membership, and a matching active workspace.

## Mounted routes and contracts

All canonical Admin operations are mounted below `/api/v1/admin/reports` (the existing `/api/v1/reports` compatibility surface remains mounted):

- **Definitions/configuration list — `GET /definitions`:** requires `admin.reports.read`. Requires `organizationId`; `page` defaults to 1; `pageSize` defaults to 25 and is capped at 100; status is `draft`, `approved`, or `retired`; sort is `name`, `-name`, `updatedAt`, or `-updatedAt` and defaults to `name`.
- **Job list — `GET /jobs`:** requires `admin.reports.read`. Requires `organizationId` and uses the same paging. Job status is optional. Sort is only `createdAt` or `-createdAt` and defaults to `-createdAt`. The authorized empty state is `{items: [], pagination: {total: 0, totalPages: 0, ...}}`.
- **Create — `POST /jobs`:** requires `admin.reports.manage`. Uses a strict organization/participant/report type/policy version/idempotency key body; requires an approved tenant policy; returns 202. An identity-derived deterministic job ID makes exact retries idempotent.
- **Detail/status — `GET /jobs/{reportId}`:** requires `admin.reports.read`. Returns status, expiry, and a safe failure code.
- **Download — `POST /jobs/{reportId}/download`:** requires `admin.reports.read`. Only ready, unexpired jobs qualify. The private signed URL lasts at most five minutes and never beyond object expiry; access is audited.
- **Retry — `POST /jobs/{reportId}/retry`:** requires `admin.reports.manage`. The strict body is `{organizationId}` and only `failed` jobs qualify.
- **Cancel — `POST /jobs/{reportId}/cancel`:** requires `admin.reports.manage`. The strict body is `{organizationId}` and only `queued` or `generating` jobs qualify.

All list reads begin with an organization equality query and then apply bounded pagination/filtering. Cross-tenant and inactive/non-selected workspace requests are rejected before querying. Report objects remain under tenant-prefixed private storage paths. The OpenAPI document publishes every route, its endpoint-specific sort enum, paging, validation responses, state restrictions, capability, and tenant behavior.

## Deployment and production verification

Source implementation and automated verification are complete in this change. Deployment was not possible from this checkout: no deployment/log-provider credential is available. Consequently the **deployed SHA is unknown**, and production request replay, authorized empty-list verification, signed-download verification, and correlation of the supplied request ID must be completed after deployment. Record the deployed Git SHA (not a local or speculative SHA), query logs by the exact request ID, and replay each matrix row using two tenants plus an expired report.
