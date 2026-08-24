# Authentication

Adults use Firebase Authentication. Provisioned child-credential sign-in uses
anonymous `POST /api/v1/auth/child-token` with an 8–24 character family code, a
2–24 character handle, and a six-digit PIN string. The property name must be
`pin` (not `password`), and the value must remain a string so leading zeroes are
preserved. Structurally invalid requests return `422 VALIDATION_ERROR`; invalid
credentials return the generic authentication failure. The PIN is stored as an
Argon2id hash plus server-held pepper; missing and invalid accounts take the same
slow verification path. The route uses generic failures, privacy-hashed
network/family/account throttling, temporary account lock state,
suspicious-attempt auditing, and mints only a Firebase custom token for an
enabled Firebase user with one active child membership. Synthetic credentials
are never returned. The client immediately exchanges the custom token and calls
`GET /api/v1/auth/session`. Activation, disablement, refresh-token revocation,
and verified consent remain parent/admin-controlled.

Parent-managed participant credentials are a separate compatibility contract:
they accept a 4–6 digit PIN at `POST /api/v1/auth/child-login`. Clients must not
send those credentials to `/auth/child-token`.

## Session bootstrap and roles

`GET /api/v1/auth/session` (with the temporary `POST` and `/api/auth` aliases) verifies a revocation-aware Firebase ID token and uses only its UID for lookup. The response envelope contains `uid`, `email`, `displayName`, canonical `roles`, `disabled`, `onboardingStatus`, and memberships (`organizationId`, canonical `roles`, and lifecycle status). Onboarding status is one of `complete`, `role_required`, `pending`, `disabled`, or `session_error`.

Firebase Authentication proves identity. `memberships` documents are authoritative for organization-scoped roles; legacy global roles in the server-written `users/{uid}` profile remain supported during migration. A membership has `userId`, `organizationId`, `roles`, and `status`. Clients cannot write either collection. Unknown stored roles are rejected and safely logged. Supported migrations are participant→child, guardian→parent, authorizedAdult/authorized_adult/authorized-adult→observer, administrator→admin, and superAdmin/super-admin→super_admin.

A first session request idempotently creates a missing `users/{uid}` identity profile with server timestamps and no role. It returns `role_required` unless an authorized workflow has created a role/membership. A pending membership or incomplete child participant context returns `pending`. Disabled identities/profiles and suspended memberships return `disabled` with no roles. Expired and malformed memberships grant no access and prevent fallback to legacy profile roles. Public sign-in cannot select mentor, observer, admin, or super_admin (and does not implicitly select parent).

Custom claims are a coarse cache only, are merged by Firebase Admin without removing unrelated keys, and never carry tenant relationships. Session and request authorization read server records rather than trusting claims. After an authorized role change, clients should force-refresh their Firebase ID token; the session response does not wait for claim propagation.

## Initial administrator provisioning

Role bootstrap is an operator-only CLI, not an HTTP endpoint. Configure the intended Firebase Admin credentials and `APP_ENV=production`, then run:

```sh
npm run admin:assign-role -- --uid <firebase-uid> --role super_admin --environment production --confirm
```

The command requires an existing Firebase Authentication user and matching Firestore user profile, validates canonical roles, preserves existing roles unless `--replace` is supplied, performs the profile and audit writes transactionally, and synchronizes the coarse custom-claim cache without overwriting unrelated claims. It is idempotent. Afterward, the user must force-refresh their ID token or sign out and back in. Never put credentials or an ID token in command arguments.
