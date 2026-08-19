# Administrative organization and child provisioning

These trusted CLIs use Firebase Admin credentials. They require `--confirm` in production, require `--environment` to exactly match `APP_ENV`, and refuse production operation when an emulator is configured. Output contains only record IDs, reconciliation actions, and claim synchronization state—never tokens or credentials.

## Bootstrap

Preview with `npm run admin:bootstrap-organization -- --name "Organization name" --timezone "America/Chicago" --environment production --dry-run --confirm`, then omit `--dry-run` to execute. The deterministic ID and transaction make exact retries safe. Any other existing organization, or multiple exact matches, produces a conflict rather than guessing.

## Child provisioning

Preview with `npm run admin:provision-child -- --uid UID --organization-id ORGANIZATION_ID --display-name "Display name" --environment production --dry-run --confirm`, then omit `--dry-run` to execute. Add `--parent-uid UID` only for an intentional relationship; the parent must have exactly one active parent membership in the same organization.

The workflow verifies Auth and the active organization, transactionally reconciles the profile, one child membership, one participant mapping and an audit event, then synchronizes claims. A claims failure records `claims_pending`; rerunning is safe. Missing records and a deterministic participant missing `firebaseUid` are repaired. Duplicate records, cross-organization data, suspended memberships, inactive participants, or conflicting identities stop with a conflict and are never deleted or silently selected.

Rollback is reconciliation, not deletion: deactivate an erroneously created membership/participant and organization using an independently authorized audited administrative process, revoke an erroneous parent link, and restore approved roles/claims. Preserve audit records. Correct conflicting records explicitly, then rerun the dry run and provisioning command.
