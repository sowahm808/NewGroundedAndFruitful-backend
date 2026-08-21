# Authorization matrix

All API decisions apply **permission + active membership + organization/program scope + resource relationship**. A route prefix is only a coarse entry boundary.

| Role | Permission group | Relationship | Tenant scope | API area | Firestore | Audit |
|---|---|---|---|---|---|---|
| child | `*.self.*`, `points.self.read`, `team.composite.read` | participant ownership | membership organization | `/api/v1/child` | API only | denied escalation |
| parent | `*.linked.*`, own observations/support, composite | parent-child link | link and membership organization | `/api/v1/parent` | API only | link lifecycle/escalation |
| mentor | `*.assigned.*`, encouragement, composite | mentor-team assignment | assignment and membership organization | `/api/v1/mentor` | API only | assignment lifecycle/escalation |
| observer | `observation.granted.*` | current participant grant | grant and membership organization | `/api/v1/observer` | API only | grant lifecycle/escalation |
| admin | program/content/quarter/team/participant/report | membership program list | membership organization | `/api/v1/admin` | API only | organization/program changes and escalation |
| super_admin | admin group plus organization/membership/role/invitation/consent/audit | active tenant membership | target membership organization only | `/api/v1/admin` | API only | every privileged lifecycle change |
| platform_super_admin | tenant administration and cross-tenant operations | explicitly provisioned custom claim | global; organization must still be explicit | `/api/v1/admin` | reviewed direct reads only; no browser writes | every operation |

`super_admin` is tenant-scoped and is never treated as a platform operator. The
`platform_super_admin` role is the only global role. It is deliberately absent
from membership bootstrap and migration: operators must provision or revoke it
explicitly in Firebase Auth, audit that operation, and force an ID-token refresh.
Membership deactivation takes effect on the next API request and immediately in
Firestore rules. Platform-claim revocation takes effect after the refreshed or
expired token is presented; use Firebase token revocation for emergency removal.

Custom claims are a coarse cache, not tenant scope. Active, well-formed
`memberships/{organizationId}_{uid}` documents provide tenant scope and roles.
Profiles are identity/migration metadata only. Compatibility-mode legacy users
may receive a session showing `organization_required`, but cannot call scoped
APIs until atomic bootstrap creates their membership. No command infers a tenant
from zero or multiple eligible memberships. A sole eligible membership may be
inferred; platform operators always supply the target tenant for scoped commands.

The corresponding UI matrix is `/child`→child, `/parent`→parent, `/mentor`→mentor, `/observer`→observer, and `/admin`→admin or super-admin. Deterministic landing routes are `/child/today`, `/parent/children`, `/mentor/teams`, `/observer/observations`, and `/admin/users`. Multi-role clients must select an explicit active role; route access never authorizes a resource.

Denials return 403 without resource details (or 404 when concealment is required), conflicts 409, validation 422, and authentication failures 401. Denial telemetry contains request/actor/route/status only, never tokens or child content.
