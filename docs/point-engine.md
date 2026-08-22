# Point engine

Points reward completion/participation only. Supported sources are daily check-in, gratitude, character assessment, Bible activity, family activity, reading, project milestone/completion, academic session, an explicitly approved observation bonus, and administrator adjustment/reversal. Ratings, correctness, grades, test performance, writing quality, and spiritual performance are never point inputs.

## Award boundary

Only static `POST /api/v1/points/sources/<source>/completions` routes are exposed. There is no generic completion route and clients cannot select a collection or submit a point amount. Each service reads the authoritative source, participant, team, organization, quarter, and effective server-owned rule. It verifies source status and actor ownership/relationship, then snapshots the rule ID, positive safe-integer amount, version, and evaluation facts. The source completion, append-only ledger entry, and participant/team/week aggregate increments share one Firestore transaction. Exact retries return the original entry; a key reused with any different source, participant, or actor is rejected.

Administrator adjustments require tenant-scoped administrator authorization, a reason, and a signed non-zero safe integer. Reversals reference an eligible original positive award and are unique per original. Both operations append compensating ledger entries and immutable audit evidence; history is never updated or deleted.

## Reconciliation

`POST /api/v1/points/reconciliations` supports dry runs and pages the authoritative ledger through a caller-visible checkpoint (maximum 500 entries). Non-dry runs build isolated participant and team totals beneath an aggregate generation and record variance/audit evidence for every page. A completed generation is activated by a single transaction that switches the organization pointer and supersedes the old generation. `POST /api/v1/points/reconciliations/rollback` atomically switches that pointer to a prior complete generation, preserves both generations, and records the administrator and reason.
