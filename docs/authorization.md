# Authorization

Roles are child, parent, mentor, observer, admin, and super_admin. Claims provide coarse authorization only. `parentChildLinks`, active team membership, and explicit observer grants provide resource authorization. Shared helpers enforce authentication, roles, parent-child links, mentor-team links, and administrative boundaries. Admin SDK code must invoke these checks because Firestore Rules do not constrain privileged server access.

## Session bootstrap and roles

`GET /api/v1/auth/session` (with the temporary `POST` and `/api/auth` aliases) verifies a revocation-aware Firebase ID token and uses only its UID for lookup. The response envelope contains `uid`, `email`, `displayName`, canonical `roles`, `disabled`, `onboardingStatus`, and memberships (`organizationId`, canonical `roles`, and `active|pending|suspended` status).

Firebase Authentication proves identity. `memberships` documents are authoritative for organization-scoped roles; legacy global roles in the server-written `users/{uid}` profile remain supported during migration. A membership has `userId`, `organizationId`, `roles`, and `status`. Clients cannot write either collection. Unknown stored roles are rejected and safely logged. Supported migrations are participant→child, guardian→parent, authorizedAdult/authorized_adult/authorized-adult→observer, administrator→admin, and superAdmin/super-admin→super_admin.

A first session request idempotently creates a missing `users/{uid}` identity profile with server timestamps and no role. It returns `role_required` unless an authorized workflow has created a role/membership; pending membership returns `pending_approval`, and a missing display name returns `profile_required`. Public sign-in cannot select mentor, observer, admin, or super_admin (and does not implicitly select parent).

Custom claims are a coarse cache only, are merged by Firebase Admin without removing unrelated keys, and never carry participant IDs, tenant relationships, team assignments, or parent-child links. Session and request authorization read server records rather than trusting claims. `claimSynchronization.status` is `synchronized`, `refresh_required`, or `retry_required`; it never exposes Firebase provider errors. After an authorized role change, clients must force-refresh their Firebase ID token or sign out and sign in again.

## Production authorization audit (2026-08-19)

The previous design had two inconsistent sources: browser rules read Authentication custom claims while the confirmed owner record had an empty Firestore `roles` array. Editing that array alone could therefore neither update an already-issued token nor make claim-based rules consistent. The selected model is Firebase Authentication for identity, server-write-only `users` and `memberships` for authoritative roles, server-write-only relationship records for resource access, and claims only as a synchronized coarse cache needed by the few permitted browser reads.

This repository contains no Angular source or Firebase Web SDK calls. All implemented feature reads and writes use the Express API and Firebase Admin SDK. The only browser Firestore allowances retained are a user's own administrative profile, a participant whose `firebaseUid` matches the authenticated UID, an active same-organization parent relationship, a mentor's active same-organization team assignment, organization-scoped admin access, and explicitly global `super_admin` access. All writes and all other/nested reads are denied. If the separately deployed frontend makes undocumented Firestore queries, they will be denied and must be migrated to the API rather than broadening the rules.

Participant IDs are **not** treated as Firebase UIDs. A participant is owned only through its server-written `firebaseUid`. `parentChildLinks/{parentUid}_{participantId}` contains `parentUid`, `participantId`, `organizationId`, `status`, and nullable `revokedAt`; both fields and organization must match. `teams/{teamId}` contains `organizationId`; mentor assignments use `teamMembers/{teamId}_mentor_{uid}` with `userId`, `teamId`, `organizationId`, `role`, and `status`. Organization membership is `memberships/{organizationId}_{uid}` with `userId`, `organizationId`, canonical `roles[]`, and `status`. These deterministic IDs are part of the rules contract and must be preserved by migrations.

Rule `get()` operations are billable document access. Authorization documents are server-write-only, so clients cannot alter roles, status, membership, points, links, or audit records. The recursive fallback denies every unspecified collection and subcollection.

The operational role service validates canonical roles with Zod, requires a `super_admin` actor for elevated assignments, prevents replacing away from `super_admin` through the generic command, writes reason/request ID/actor/timestamps to the audit log, preserves unrelated claims, and is idempotent. Initial bootstrap is allowed only when no active super-admin exists. If Firestore commits but claim synchronization fails, the failure is audited as retryable; rerunning the same command repairs claims without duplicating the role.

## Parent resource matrix

| Resource                   | Parent rule                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Dashboard/children/reports | Active membership plus explicit same-organization parent-child link                   |
| Character selections       | Linked child, active quality records, and active same-organization quarter            |
| Observations               | Linked child on create; creator UID and organization on read                          |
| Family completion          | Linked child and active same-organization configured activity; idempotent transaction |
| Support                    | Linked child/category on create; requester UID and organization on read               |
| Team progress              | Team must be attached to a linked child; totals come only from the ledger             |
