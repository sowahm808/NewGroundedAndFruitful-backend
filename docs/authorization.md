# Authorization

Roles are child, parent, mentor, observer, admin, and super_admin. Claims provide coarse authorization only. `parentChildLinks`, active team membership, and explicit observer grants provide resource authorization. Shared helpers enforce authentication, roles, parent-child links, mentor-team links, and administrative boundaries. Admin SDK code must invoke these checks because Firestore Rules do not constrain privileged server access.

## Session bootstrap and roles

`GET /api/v1/auth/session` (with the temporary `POST` and `/api/auth` aliases) verifies a revocation-aware Firebase ID token and uses only its UID for lookup. The response envelope contains `uid`, `email`, `displayName`, canonical `roles`, `disabled`, `onboardingStatus`, and memberships (`organizationId`, canonical `roles`, and `active|pending|suspended` status).

Firebase Authentication proves identity. `memberships` documents are authoritative for organization-scoped roles; legacy global roles in the server-written `users/{uid}` profile remain supported during migration. A membership has `userId`, `organizationId`, `roles`, and `status`. Clients cannot write either collection. Unknown stored roles are rejected and safely logged. Supported migrations are participant→child, guardian→parent, authorizedAdult/authorized_adult/authorized-adult→observer, administrator→admin, and superAdmin/super-admin→super_admin.

A first session request idempotently creates a missing `users/{uid}` identity profile with server timestamps and no role. It returns `role_required` unless an authorized workflow has created a role/membership; pending membership returns `pending_approval`, and a missing display name returns `profile_required`. Public sign-in cannot select mentor, observer, admin, or super_admin (and does not implicitly select parent).

Custom claims are a coarse cache only, are merged by Firebase Admin without removing unrelated keys, and never carry tenant relationships. Session and request authorization read server records rather than trusting claims. After an authorized role change, clients should force-refresh their Firebase ID token; the session response does not wait for claim propagation.
