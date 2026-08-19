# Roles and permissions

The canonical stored `UserRole` values are exactly `child`, `parent`, `mentor`, `observer`, `admin`, and `super_admin`. “Authorized adult” is only a possible label for `observer`; it is not a stored role. Roles do not inherit from one another.

`memberships/{membershipId}` is authoritative. A membership contains `userId`, `organizationId`, `roles`, `status`, and an integer `version`. Only `active` memberships participate in authorization. Profile roles and custom claims are compatibility caches and never create tenant scope. A `super_admin` is therefore a tenant administrator, never an implicit platform administrator. The first tenant membership is created only by `npm run admin:bootstrap-organization` in a protected operational environment.

The typed permission catalog and complete role mapping live in `src/auth/policy.ts`. In summary:

| Role | Permissions | Required relationship/scope |
|---|---|---|
| child | self journey, check-in, character, Bible, reading, project and points; composite team progress | UID owns active participant in membership organization |
| parent | linked child summary, own/linked observations, family, support, linked report, composite progress | active same-organization parent-child link |
| mentor | assigned team, project guidance, assigned reading, encouragement, composite progress | active same-organization mentor assignment |
| observer | create granted observations; read own granted observations | active, unrevoked, unexpired participant grant |
| admin | program/configuration/content/quarter/team/participant/scoped reports | active membership and assigned program |
| super_admin | all admin permissions plus organization/membership/role/invitation/consent/audit | active membership in the target organization |

Parents receive summary DTOs, not raw check-ins, reflections, surveys, Bible answers, or mentoring notes. No listed role can alter point/audit history, impersonate a child, or trust a client-selected relationship ID.

## Operational constraints

Super-admin assignment requires an existing tenant super-admin (or protected bootstrap), explicit organization, reason, expected membership version, audit event, claims synchronization, and client token refresh. Removal must reject a version conflict and removal of the final active tenant super-admin. These lifecycle workflows remain server-only.
