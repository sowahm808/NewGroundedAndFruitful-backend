# Bible content workflow operations

## Current-state and policy decisions

The former Bible endpoint used generic `bibleActivities`, accepted a polymorphic client response, exposed persisted activity records directly, and silently skipped an award when no point rule existed. There was no two-DOCX import, protected answer model, review gate, local-date assignment, import lifecycle, or atomic Bible-specific completion command.

The production boundary now uses server-resolved child context and the organization's IANA timezone. Import records progress through `needs_review -> validated -> committed`; commit creates only `draft` content. Publishing is an explicit administrator command and requires an `active` quarter. Correctness is calculated and stored privately but is withheld from every child response because the product privacy decision remains unresolved. Participation points come only from the active `bible_activity` rule and are independent of correctness. Completion, immutable ledger creation, aggregates, and redacted audits share one Firestore transaction.

## Endpoint inventory

| Method and path                                               | operationId                              |
| ------------------------------------------------------------- | ---------------------------------------- |
| POST `/api/v1/admin/bible-imports`                            | `createBibleImport`                      |
| GET `/api/v1/admin/bible-imports/{importId}`                  | `getBibleImport`                         |
| PATCH `/api/v1/admin/bible-imports/{importId}/items/{itemId}` | `correctBibleImportItem`                 |
| POST `/api/v1/admin/bible-imports/{importId}/validate`        | `validateBibleImport`                    |
| POST `/api/v1/admin/bible-imports/{importId}/commit`          | `commitBibleImport`                      |
| GET `/api/v1/admin/bible-content`                             | `listBibleContent`                       |
| GET/PATCH `/api/v1/admin/bible-content/{contentSetId}`        | `getBibleContent` / `updateBibleContent` |
| POST `/api/v1/admin/bible-content/{contentSetId}/publish`     | `publishBibleContent`                    |
| POST `/api/v1/admin/bible-content/{contentSetId}/archive`     | `archiveBibleContent`                    |
| GET `/api/v1/child/bible`                                     | `getChildBibleToday`                     |
| GET `/api/v1/child/bible/history`                             | `getChildBibleHistory`                   |
| PUT `/api/v1/child/bible/{activityId}/draft`                  | `saveChildBibleDraft`                    |
| POST `/api/v1/child/bible/{activityId}/complete`              | `completeChildBibleActivity`             |

## Persistence and deployment

New server-only collections are `bibleImports`, `bibleImportCleanupJobs`, `bibleContentSets`, `bibleActivities`, and `bibleResponses`; the existing `pointLedger`, aggregate, point-rule, and `auditLogs` collections are reused. Composite indexes cover local-date assignment, content-set activities, and private child history. Large/private fields are exempted from indexing. Existing Firestore and Storage rules deny all browser access to these records and objects.

Deploy indexes and rules first. Configure `FIREBASE_PROJECT_ID` and the exact bucket name shown by Firebase/Google Cloud as `FIREBASE_STORAGE_BUCKET` (newer default buckets normally use `PROJECT_ID.firebasestorage.app`; never infer this when the console shows a different name). The Admin SDK initializes that bucket on the single application instance. Grant the Render service account `roles/storage.objectAdmin` **only on the dedicated import bucket**; do not grant project Owner/Editor and do not relax client Storage Rules. Startup resolves bucket metadata once, and `/health` reports only the redacted dependency status rather than probing or exposing the bucket name on every request.

Source objects use `organizations/{organizationId}/bible-imports/{importId}/source/questions.docx` and `.../answer-key.docx`. They remain private and have no Firebase download token. Retain both while review is pending. Delete rejected or abandoned imports after 30 days; retain approved sources only for the documented audit/legal period, then delete them. Configure a bucket lifecycle rule as a backstop for abandoned health/cleanup prefixes, audit every administrative source download, and never expose answer-key paths or bytes through child APIs. Cleanup jobs are bounded recovery work and should alert after the operator-defined retry limit.

Configure exactly one active `bible_activity` point rule per organization/quarter, deploy the API, import and review the documents, validate, commit the draft, and publish only after human sign-off. Verify an authorized admin import and a 0/3 versus 3/3 staging completion before enabling the separate frontend. Roll back the API binary first; archive newly published content if necessary. Never rewrite ledger or completed responses.

## Supplied document validation (quarter 2026-07-01 through 2026-09-30)

The bounded parser found 90 structurally materialized activities, 14 blocking errors, and 18 review warnings. Blocking source issues include malformed choice lines on July 8 and August 8, an answer-choice mismatch on July 12, a duplicated prompt on September 6, and malformed/mismatched answer-key choice content on September 8. Warnings identify activities with question counts other than three and the five-choice questions on July 9, September 9, and September 11. These findings intentionally prevent validation/commit until an administrator reviews and corrects the preview; no grammar, theology, references, questions, or answers were silently changed.

## Safe response examples

Admin import preview: `{ "data": { "id": "...", "status": "needs_review", "validationSummary": { "activityCount": 90, "errorCount": 14, "warningCount": 18 }, "items": [] } }` (items normally contain protected answer mappings and must stay in the admin boundary).

Child assignment: `{ "data": { "available": true, "quarterId": "q1", "localDate": "2026-07-01", "calculatedAt": "2026-07-01T12:00:00.000Z", "responseStatus": "not_started", "activity": { "id": "...", "title": "Watchman", "questions": [{ "id": "q1", "prompt": "...", "choices": [{ "id": "a", "label": "a", "text": "..." }] }] } }`. Correct choices, source paths, private answers, and scores are structurally absent.
