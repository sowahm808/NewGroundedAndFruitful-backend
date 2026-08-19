# Authentication

Adults use Firebase Authentication. Child sign-in is designed around family code, handle, and an Argon2id password hash plus server-held pepper. Implementations must use generic failures, account-based and device/IP-supported throttling, temporary lockout, suspicious-attempt auditing, and mint only Firebase custom tokens. Synthetic credentials are never returned. Activation, disablement, refresh-token revocation, and verified consent are parent/admin-controlled. No child-login endpoint is enabled until its persistent rate-limit and audit repository is deployed.

## Session bootstrap and roles

`GET /api/v1/auth/session` (with the temporary `POST` and `/api/auth` aliases) verifies a revocation-aware Firebase ID token and uses only its UID for lookup. The response envelope contains `uid`, `email`, `displayName`, canonical `roles`, `disabled`, `onboardingStatus`, and memberships (`organizationId`, canonical `roles`, and `active|pending|suspended` status).

Firebase Authentication proves identity. `memberships` documents are authoritative for organization-scoped roles; legacy global roles in the server-written `users/{uid}` profile remain supported during migration. A membership has `userId`, `organizationId`, `roles`, and `status`. Clients cannot write either collection. Unknown stored roles are rejected and safely logged. Supported migrations are participant→child, guardian→parent, authorizedAdult/authorized_adult/authorized-adult→observer, administrator→admin, and superAdmin/super-admin→super_admin.

A first session request idempotently creates a missing `users/{uid}` identity profile with server timestamps and no role. It returns `role_required` unless an authorized workflow has created a role/membership; pending membership returns `pending_approval`, and a missing display name returns `profile_required`. Public sign-in cannot select mentor, observer, admin, or super_admin (and does not implicitly select parent).

Custom claims are a coarse cache only, are merged by Firebase Admin without removing unrelated keys, and never carry tenant relationships. Session and request authorization read server records rather than trusting claims. After an authorized role change, clients should force-refresh their Firebase ID token; the session response does not wait for claim propagation.

## Initial administrator provisioning

Role bootstrap is an operator-only CLI, not an HTTP endpoint. Configure the intended Firebase Admin credentials and `APP_ENV=production`, then run:

```sh
npm run admin:assign-role -- --uid <firebase-uid> --role super_admin --environment production --confirm
```

The command requires an existing Firebase Authentication user and matching Firestore user profile, validates canonical roles, preserves existing roles unless `--replace` is supplied, performs the profile and audit writes transactionally, and synchronizes the coarse custom-claim cache without overwriting unrelated claims. It is idempotent. Afterward, the user must force-refresh their ID token or sign out and back in. Never put credentials or an ID token in command arguments.
