# Backend rollback runbook

This runbook is non-destructive. It does not authorize a production deployment, migration, deletion, ledger edit, or rules broadening.

## Preconditions and evidence

1. Record the deployed Render revision, Firebase project, rules release, migration compatibility mode, index state, error-rate baseline, and Firestore export identifier.
2. Confirm `MEMBERSHIP_ENFORCEMENT_MODE=compatibility` remains available until membership backfill and ambiguity verification are approved.
3. Preserve migration checkpoints, collision reports, count verification, and immutable audit events. Never reuse a production checkpoint in staging.

## Application rollback

1. Disable the affected frontend/server feature flag or stop affected traffic.
2. Roll Render back to the last verified image and keep the same secret set.
3. Smoke-test `/health`, revoked-token rejection, session role resolution, a same-tenant allowed request, and cross-tenant denial.
4. Do not delete documents written by the newer release. Quarantine unsupported additive records for later reconciliation.

## Data, indexes, rules, and credentials

- Point ledger and audit history are append-only. Correct a bad award only with an authorized linked adjustment/reversal; never edit or delete history.
- Additive indexes may remain. Remove an index only after the previous release is verified not to query it.
- Restore a previous Firestore/Storage rules release only when it is at least as restrictive. Never broaden browser access as an incident workaround.
- For credential migration failure, stop the batch, retain its checkpoint and compatibility read, report collisions, and verify counts before resuming. Delayed deletion requires separate authorization.
- If a child-login secret or Firebase key is suspected compromised, disable the affected path, rotate the provider key, update Render secrets, revoke refresh tokens where required, redeploy, and retain redacted audit evidence.

## Exit criteria

Rollback is complete only after error/denial metrics return to baseline, tenant-isolation tests pass, append-only counts reconcile, and an incident owner records the revision and evidence. A Firestore export restore is a last resort and requires separate review because it can discard valid concurrent writes.
