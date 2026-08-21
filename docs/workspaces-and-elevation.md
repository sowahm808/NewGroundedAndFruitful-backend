# Workspaces and temporary elevation

`workspaces` is the canonical tenant registry. Organization documents remain in place during the additive migration; memberships carry both `organizationId` (compatibility) and `workspaceId` for personal workspaces. All domain records continue to use the non-null `organizationId` tenant key, whose value is the workspace ID.

## Registration and sessions

Clients submit `POST /api/v1/auth/registration-intent` with intent `personal` or `organization`. This authentication-only boundary obtains the UID from a revocation-aware Firebase token, rejects disabled accounts, and records no client-supplied authority. It does not require or create a role, membership, organization, or workspace. The legacy `POST /api/v1/auth/registration` flow remains separate.

The canonical transition is `new_authenticated_user -> registration_intent_selected -> personal_workspace_required | organization_setup_required -> onboarding_complete`. An identical retry returns the stored transition without another write. A user may change intent before bootstrap; once any membership/workspace exists, an incompatible change returns `409` and never deletes data. Trusted bootstrap logic—not intent selection—creates the workspace and membership and assigns any workspace-scoped role. `POST /onboarding/organization` remains authenticated and creates the organization and initial membership without changing platform roles.

Login resolves identity first and returns every authorized workspace. A single workspace is selected automatically; otherwise clients must call `PUT /api/v1/auth/session/workspace`. Selection is persisted convenience state, not authorization, and every resource request is still checked against active server-owned membership.

## Temporary elevation

Grants are short-lived Firestore records evaluated by the server. Platform super administrators with authentication no older than five minutes may grant them; self-grants are rejected. Scope, reason, start/end, optional maximum uses, status and audit records are mandatory. Duration is capped at eight hours. Limited use is consumed transactionally, revocation is immediate, and expired grants are excluded. Elevated roles are never copied to user profiles or Firebase claims.

## Deployment and rollback

1. Deploy composite indexes and Firestore rules.
2. Deploy the backward-compatible API.
3. Run `npm run migrate:personal-workspaces -- --dry-run`, review `ambiguous`, then run batches with `--limit` and `--checkpoint`.
4. Deploy clients that consume `workspaces` and select context.

Rollback the API/client first. The additive workspace, membership and migration records may remain dormant; do not delete legacy `organizations` or `organizationId`. Revoke active elevation grants before rollback. If data removal is required, delete only migration-created records identified by `migrationRecords/personal-workspace-*`, after export and review.
