# Angular/backend contract comparison

Audit date: 2026-08-19. No Angular source or exported production contract is present in this repository. The paths supplied to this audit are therefore **proposed contracts**, not evidence of frontend calls. This comparison is based on the mounted Express router and executable service code.

| Proposed frontend contract | Executable backend contract | Difference | Classification |
|---|---|---|---|
| `GET /parent/dashboard` | exact path | Response is calculated at request time and embeds up to 50 linked-child summaries; it supplements rather than replaces `/parent/children`. It now includes organization context and `calculatedAt`. | partial: service tests do not exercise the full aggregate |
| `GET /parent/children` | exact path | `limit` (1–50), cursor, search, and participant status are accepted. Only active links are eligible. Cursor is currently a document ID rather than a signed/encoded query tuple and filtering happens after a bounded relationship read. | partial |
| `GET /parent/children/{childId}` | exact path | Active link and same-organization participant required; concealment policy is 404 for absent/unrelated records. | partial: runtime document schemas remain incomplete |
| `GET/PATCH /parent/character` | absent | Existing APIs concern quality libraries and child/quarter selections (`GET /character/qualities`, `GET /character/selections/{childId}/{quarterId}`, `PUT /character/selections`). The proposed resource and parent write authority are ambiguous. | externally blocked by product policy |
| `GET/POST /parent/observations` | exact paths | List accepts `limit`, cursor, and optional `childId`; create accepts child, optional quality, constructive description, and observation timestamp. Author, tenant, moderation, and audit identity are server-set. Active relationships are rechecked. | partial: no approved safeguarding channel or moderation lifecycle |
| `GET /parent/family/activities` | backend uses `GET /parent/family-activities?childId=…` | URL and pagination contract differ. | partial |
| `POST /parent/family/activities/{activityId}/completions` | backend currently uses `POST /parent/family-activities/completions` | Backend operation creates a completion but does not atomically select/snapshot a point rule and append an award. It must not be exposed as the proposed award workflow. | unsafe; launch blocked |
| Academic-support configuration/list/create | exact paths | Configuration is the active category list. Request create sets protected lifecycle fields server-side. No parent closure/update API exists. | partial |
| `GET /parent/reports` | backend uses `GET /parent/reports/{childId}` | Required participant selection differs. Export/detail/download policy is undefined. | partial; exports blocked |

## Envelope and error decisions

The version-one failure shape is only `{ "error": { "code", "message", "requestId" } }`; the previous duplicate top-level compatibility fields were removed because they contradicted the established contract. Validation may add `error.fieldErrors`. Success-envelope drift remains explicitly partial for older parent handlers; changing those responses without the Angular contract would be a compatibility guess.

All timestamps emitted by parent services are ISO 8601 strings or `null`. Lists sort child names ascending with ID tie-breaks, and observations/support requests newest-first with ID tie-breaks. Existing cursors are resource IDs; they are not opaque and must be replaced before those lists are classified verified for production pagination.

