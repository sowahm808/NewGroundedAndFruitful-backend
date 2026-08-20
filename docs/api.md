# API

The versioned API is rooted at `/api/v1`; `GET /health` is published. The OpenAPI 3.1 contract is `openapi.yaml`. Published features include auth session/child login, participant and child journeys, configured completion awards, administration/configuration, and the [Phase 8 parent journey](parent-journey.md). Endpoints are added only with validation, relationship authorization, service/repository separation, and tests. Envelopes are resource responses or `{ "error": { "code", "message", "requestId" } }`; stack traces are never returned.
