# Membership migration runbook

Production remains in `MEMBERSHIP_ENFORCEMENT_MODE=compatibility` while legacy user profiles are backfilled. Compatibility never merges sources: an active membership wins, while the existence of a pending, suspended, revoked, or malformed membership blocks legacy fallback. Legacy roles allow sign-in, but organization-owned operations require explicit server-controlled organization scope and all normal resource relationships.

## First organization

The first tenant is created by a trusted CLI rather than a runtime endpoint. This is
intentional: HTTP tenant authority comes from an existing membership, so granting the
first membership through that same boundary would be circular. The CLI uses Admin
SDK credentials, requires an explicit Firebase UID, and accepts `super_admin` only as
a one-time migration credential on a non-disabled legacy profile. It creates the
canonical tenant `admin` role; `super_admin` is not retained as platform-global
authority.

Run a dry-run with the production service account environment, review its output,
then repeat with confirmation:

```bash
APP_ENV=production npm run admin:bootstrap-organization -- \
  --uid '<firebase-uid>' --name 'Grounded & Fruitful' \
  --slug 'grounded-and-fruitful' --timezone 'America/Chicago' \
  --environment production --dry-run

APP_ENV=production npm run admin:bootstrap-organization -- \
  --uid '<firebase-uid>' --name 'Grounded & Fruitful' \
  --slug 'grounded-and-fruitful' --timezone 'America/Chicago' \
  --environment production --confirm
```

The transaction creates `organizations`, `memberships`, `migrationRecords`, and
immutable `auditLogs` records and marks the `users` profile migrated. It rejects
duplicate names/slugs, existing active memberships, disabled identities, repeated or
concurrent consumption, and ineligible profiles. After success, force-refresh the
Firebase ID token and call `GET /api/v1/auth/session`; verify membership authorization,
`migrationRequired: false`, the expected `activeOrganizationId`, and
`onboardingStatus: complete`.

Deploy code before the dry-run, bootstrap once, verify session and an
organization-scoped quarter create, then tighten membership enforcement. Rollback is
operational rather than destructive: revoke the new membership and disable the
organization through an audited Admin SDK repair, restore compatibility mode, and
retain migration and audit records. Never delete the audit trail or reuse the
one-time marker.

Run the non-destructive workflow in order:

```bash
npm run migrate:memberships -- --dry-run --environment production
npm run migrate:memberships -- --environment production --confirm
npm run migrate:memberships:verify -- --environment production
```

The migration must use bounded batches and a durable checkpoint, resume rather than restart, preserve `users.roles`, report unknown roles and ambiguous organization scope without inventing either, write an audit summary, and retain a rollback flag. Review the dry-run ambiguity report before confirmation. Strict mode may be enabled in staging only after verification shows every applicable active user has canonical membership roles and explicit organization scope. Promote strict mode to production only after authorization regression tests and explicit approval.
