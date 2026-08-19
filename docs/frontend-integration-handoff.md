# Backend handoff for the separate frontend repository

Audit date: 2026-08-19. This document describes backend evidence only. No frontend repository was accessed or modified.

## Connection and token contract

- Production API base URL supplied by the product contract: `https://newgroundedandfruitful-backend.onrender.com/api/v1`.
- Stable API artifact: [`../openapi.yaml`](../openapi.yaml). It is currently incomplete and must not yet be treated as a generated production SDK source.
- Send `Authorization: Bearer <Firebase ID token>` on protected operations. The API verifies revocation. After `POST /auth/child-token`, exchange the returned custom token with Firebase Authentication, then use the resulting ID token; never use the custom token as the bearer token.
- Successful handlers use `{ "data": ... }`. Failures use `{ "error": { "code", "message", "requestId" } }`; validation failures may additionally include `error.fieldErrors`. Private responses use `Cache-Control: no-store`.

## Integration matrix and payload authority

The exhaustive mounted-path and authorization matrix is [`route-inventory.md`](route-inventory.md). Exact published request and response schemas are the OpenAPI `components.schemas` and operation `$ref` values. Where the route inventory says OpenAPI is absent, there is **no approved frontend payload contract** yet; consumers must not infer one from Firestore documents or TypeScript implementation details.

| Area | Frontend integration status | Contract source |
|---|---|---|
| session and child credential exchange | integrate in staging | OpenAPI `/auth/*` |
| participant summary | integrate after relationship fixtures | OpenAPI `/participants/{id}` |
| child journey | gated staging integration; media upload remains disabled | OpenAPI `/child/*` |
| parent journey | integrate only documented operations; character policy and completion paths remain blocked/partial | OpenAPI `/parent/*` plus comparison guide |
| points | do not expose generic completion as a source-workflow substitute | OpenAPI `/points/*` and point-engine guide |
| administration | do not integrate until OpenAPI and cross-tenant emulator coverage are complete | executable inventory only |
| mentor and observer | unavailable: dedicated routers are absent | none |

Opaque cursor behavior is incomplete. Existing parent and child list cursors are an unstable backend implementation detail until datastore-tuple cursor tests and the OpenAPI contract are complete.

## Session landing states

Do not integrate role landing yet. The required `onboardingState` contract (`complete`, `role_required`, `pending`, `disabled`, `session_error`) is not executable: the current response field is `onboardingStatus` and can emit `profile_required`, `provisioning_required`, or `pending_approval`. This is a compatibility blocker, not permission to guess a client mapping. Once corrected and versioned, a `role_required` response must not repeatedly redirect a user already on the frontend's role-required page. Authorization must follow canonical session roles, never stale token claims or a locally selected organization.

## Feature flags and known blockers

No public, stable feature-flag response is implemented. Keep frontend release flags off for mentor, observer, reports/exports, notifications, safeguarding, survey aggregates, media upload, reconciliation, and administration routes absent from OpenAPI. Special-activity and survey public-enablement policy requires approval. Storage of ordinary safeguarding incidents is prohibited pending a separately reviewed restricted design.

## Staging identities and fixtures

No production or shared-staging credentials are committed. For local testing, start the Firebase emulators and run `npm run seed`; the seed script refuses a non-emulator environment. Use two organizations and exercise self, linked parent, unrelated child, suspended member, assigned mentor, and observer-grant denials before enabling a route. Real staging identities must be supplied through an approved secret channel.

## Error handling

Clients must handle at least `400`, `401`, `403`, `404`, `409`, `422`, `429`, and `5xx` without discarding `error.requestId`. Treat `401` as requiring fresh Firebase authentication, `409` as an optimistic-concurrency/idempotency conflict, and `429` according to `Retry-After`. Do not convert `403` or `404` into evidence that a cross-tenant resource exists.
