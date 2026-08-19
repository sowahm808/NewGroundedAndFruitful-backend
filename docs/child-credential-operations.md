# Child credential operations

Child credentials are authoritative server-side records. Browser writes are forbidden. The lookup document ID is a lowercase HMAC-SHA-256 digest of the NFKC-normalized family code, a newline, and normalized handle. PINs are Argon2id hashes with an independent pepper. Neither secret nor the raw PIN/family code may enter logs, audit payloads, tickets, or command history.

## Provision

Create an active `familyAccess/{id}` in the same organization first. Parent operation is denied unless that record explicitly sets `allowParentCredentialManagement: true` and an active same-organization `parentChildLinks` relationship exists. Otherwise the actor needs an active same-organization `super_admin` membership.

```sh
npm run admin:provision-child-credential -- --organization-id ORG --participant-id PARTICIPANT --family-access-id FAMILY --actor-uid ADMIN_UID --handle HANDLE --confirm
```

The generated family code and six-digit PIN are emitted once to this approved secret-delivery terminal. The Firebase Admin identity has no synthetic email. A failed transaction triggers best-effort deletion of a newly created Auth identity; investigate any deletion failure before retrying.

## Migration

Deploy the lookup secret and index first. Back up Firestore, process bounded pages, and save each reported checkpoint externally:

```sh
npm run migrate:child-credentials -- --dry-run --batch-size 100
npm run migrate:child-credentials -- --batch-size 100 --checkpoint LAST_ID
npm run migrate:child-credentials -- --verify --batch-size 100 --checkpoint LAST_ID
```

Collision/invalid reports exit 3 and require manual resolution. Copies retain `migration.legacyDocumentId` and rollback instructions; migration never deletes the source. Rollback deletes only verified HMAC copies, rolls back the application, and preserves legacy records. Cleanup needs separate approval after validation and the rollback window.

## Deployment and rollback order

1. Configure independent high-entropy `CHILD_LOGIN_LOOKUP_SECRET` and `CHILD_LOGIN_PEPPER` on Render.
2. Deploy indexes and wait for `childCredentials(participantId, disabled)` to become ready.
3. Deploy compatibility code, back up, dry-run, review collisions, migrate in bounded pages, and verify each page.
4. Provision a canary and verify generic failures, lockout, active context, and token exchange. Monitor only redacted event IDs.
5. For rollback, roll back code before configuration; remove only verified migration copies if needed and revoke affected refresh tokens. Never delete legacy sources.

PIN rotation, handle/family-code changes, disable, and re-enable use the service operations and revoke Firebase refresh tokens. Family-code rotation moves every family credential atomically. Deliver generated values through the one-time channel.
