# API

The versioned API is rooted at `/api/v1`; `GET /health` is currently published. The OpenAPI 3.1 contract is `openapi.yaml`. Planned protected resources include child authentication, participants and activities, teams/progress, Bible responses, observations, reading, projects, academic support, surveys, quarters, content, and reports. Endpoints are added only with validation, authorization, service/repository separation, and tests. Envelopes are `{ "data": ... }` or `{ "error": { "code", "message" } }`; stack traces are never returned.
