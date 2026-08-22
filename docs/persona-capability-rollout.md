# Personal owner / parent persona rollout

## Diagnosis

The production 403 is explained by the executable policy, independently of child links: personal bootstrap persisted only `roles: ["owner"]` and `workspaceRoles: ["owner"]`, while the mounted parent router required `parent`. The request was rejected before `ParentService.children` ran. That service already returns an empty `data` array when its link query is empty. No production request ID or production log access was supplied, so this conclusion is a source-policy diagnosis rather than a request-log correlation.

A second legacy registration path assigned `roles: ["admin"]` to a personal creator. It has been corrected rather than treating owner as admin. The mounted route is `GET /api/v1/parent/children`, and the OpenAPI path is `/parent/children` under the API server prefix.

## Contract

Before, a personal membership/session collapsed governance into roles:

```json
{ "workspaceRoles": ["owner"], "roles": ["owner"], "effectiveRoles": ["owner"] }
```

After, the server-owned additive projection is:

```json
{
  "workspaceRoles": ["owner"],
  "personas": ["parent"],
  "capabilities": [
    "parent.dashboard.read",
    "parent.children.read",
    "parent.observations.create",
    "family.activities.read",
    "support.requests.create",
    "parent.reports.read",
    "parent.consent.manage"
  ],
  "effectiveRoles": ["owner", "parent"]
}
```

`effectiveRoles` is compatibility output only. Authorization derives capabilities from the active membership's canonical `personas`; it never infers parent or admin authority from owner or registration intent. Parent-child reads additionally require active links in the active workspace.

## Matrix

| Assignment                          |         Parent capability |     Admin capability | Child scope                                   |
| ----------------------------------- | ------------------------: | -------------------: | --------------------------------------------- |
| personal owner + parent persona     |                       yes |                   no | active links in active personal workspace     |
| owner without parent persona        |                        no |                   no | none                                          |
| organization admin                  |                        no |                  yes | none                                          |
| organization admin + parent persona |                       yes |                  yes | active links in active organization workspace |
| platform super admin                | no implicit parent access | platform-only grants | none without persona and link                 |

## Migration and rollback

Run `npm run migrate:personal-workspaces -- --dry-run --limit=200`, review counts and every ambiguity, then continue with `--checkpoint=<checkpoint>`. The output confirmation digest binds the candidate IDs and checkpoint. Execution is refused unless invoked with `--execute --confirm=<confirmationDigest>`. Each write revalidates active membership, personal workspace ownership, and personal registration intent in a transaction and writes an immutable `migrationAudit` before/after record.

The migration was not executed from this development environment because it is intentionally production-data dependent. Rollback is additive and record-specific: for each reviewed run, restore the exact `rollback.value` to the referenced membership's `personas` field and append a new rollback audit event; never delete the original migration audit.

## Deployment

Deploy backend/session and OpenAPI first, regenerate frontend types, then deploy capability-driven frontend navigation. Dry-run and review the migration before execution. Verify no-link and linked personal parents, organization admin with and without parent persona, and cross-workspace denial. Removing `effectiveRoles` compatibility must wait for adoption telemetry.
