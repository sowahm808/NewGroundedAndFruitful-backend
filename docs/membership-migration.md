# Membership migration runbook

Production remains in `MEMBERSHIP_ENFORCEMENT_MODE=compatibility` while legacy user profiles are backfilled. Compatibility never merges sources: an active membership wins, while the existence of a pending, suspended, revoked, or malformed membership blocks legacy fallback. Legacy roles allow sign-in, but organization-owned operations require explicit server-controlled organization scope and all normal resource relationships.

Run the non-destructive workflow in order:

```bash
npm run migrate:memberships -- --dry-run --environment production
npm run migrate:memberships -- --environment production --confirm
npm run migrate:memberships:verify -- --environment production
```

The migration must use bounded batches and a durable checkpoint, resume rather than restart, preserve `users.roles`, report unknown roles and ambiguous organization scope without inventing either, write an audit summary, and retain a rollback flag. Review the dry-run ambiguity report before confirmation. Strict mode may be enabled in staging only after verification shows every applicable active user has canonical membership roles and explicit organization scope. Promote strict mode to production only after authorization regression tests and explicit approval.
