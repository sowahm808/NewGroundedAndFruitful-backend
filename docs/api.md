# API

The versioned API is rooted at `/api/v1`; `GET /health` is currently published. The OpenAPI 3.1 contract is `openapi.yaml`. Currently published feature routes are auth session/child login, participant summary reads, and configured completion awards. Other named resources are planned, not implemented. Endpoints are added only with validation, relationship authorization, service/repository separation, and tests. Envelopes are `{ "data": ... }` or `{ "error": { "code", "message", "requestId" } }`; stack traces are never returned.
