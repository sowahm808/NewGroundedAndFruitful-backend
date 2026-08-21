# Organization onboarding authorization repair

## Regression and role model

`bootstrapLegacyAdministrator` previously wrote `roles: ["admin"]` after it
created the organization membership. Firebase Admin replaces the complete
custom-claims object, so this omitted the independently provisioned
`super_admin` role. The corrected model stores global grants in
`platformRoles`, tenant grants on active `memberships`, and publishes their
server-calculated union in `roles` for compatibility. Request bodies are never
a source of roles.

## Recovery

First inspect without writing:

```sh
npm run auth:repair-role -- \
  --uid <firebase-uid> \
  --restore-platform-role super_admin \
  --dry-run
```

Apply only after the report says trusted evidence is present:

```sh
npm run auth:repair-role -- \
  --uid <firebase-uid> \
  --restore-platform-role super_admin \
  --apply
```

The command requires the completed, UID-specific legacy bootstrap migration,
the corroborating server-owned user profile grant, and no later explicit
revocation. It does not infer authority from email, name, or admin membership.
Apply mode preserves active membership roles, is idempotent, and writes
`migrationRecords/role-repair-<uid>-super_admin`. When the report says
`tokenRefreshRequired`, the user must sign out and sign in or force-refresh the
Firebase ID token before using the new claim.

## Verification and deployment

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:rules`,
`npm run test:integration`, `npm run openapi:check`, and `npm run build`. Deploy
the backend before running apply-mode recovery. Verify `/api/v1/auth/session`
returns `platformRoles: ["super_admin"]`, effective `roles` containing both
`super_admin` and `admin`, the active admin membership, and
`tokenRefreshRequired: false` after refresh.

Deploy the commit as a normal backend release; no frontend deployment or
runtime OpenAPI fetch is required. Roll back the backend artifact to the prior
version if necessary, but do not roll custom claims back to `roles: ["admin"]`.
The safe data rollback is the dedicated, authorized platform-role revocation
workflow, which leaves the organization membership intact and records an
audit event.
