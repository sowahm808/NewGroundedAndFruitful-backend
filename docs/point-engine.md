# Point engine

Points reward completion/participation only. Sources are daily check-in, gratitude, character assessment, Bible activity, family activity, reading, project milestone, academic session, approved observation bonus, and explicit adjustment. Ratings, correctness, grades, test performance, writing quality, and spiritual performance are not point inputs.

A rule is selected at award time and its resulting amount is snapshotted into an immutable ledger entry. Deterministic IDs make transaction `create` idempotent while the same transaction increments participant/team aggregates. Corrections append an adjustment referencing the original. Rebuild tooling should scan ledger entries into a new aggregate generation before atomic activation; it must never mutate ledger history.
