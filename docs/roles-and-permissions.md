# Roles and permissions

The canonical `UserRole` values are exactly `child`, `parent`, `mentor`, `observer`, `admin`, `super_admin`, and `platform_super_admin`. “Authorized adult” is only a possible label for `observer`; it is not a stored role. Roles do not inherit from one another, and `platform_super_admin` is claim-only rather than a tenant membership role.

`memberships/{membershipId}` is authoritative. A membership contains `userId`, `organizationId`, `roles`, `status`, and an integer `version`. Only `active` memberships participate in authorization. Profile roles and ordinary custom claims are compatibility caches and never create tenant scope. A `super_admin` is therefore a tenant administrator, never an implicit platform administrator. `platform_super_admin` is the sole exception: it is an explicitly provisioned global Firebase custom claim and is never granted by migration or tenant bootstrap. The first tenant membership is created atomically by the authenticated `/api/v1/onboarding/organization` migration endpoint, or by `npm run admin:bootstrap-organization` in a protected operational environment.

Browser writes remain denied. Browser reads are limited to self/active
relationships plus organization-scoped administrator reads of the safe
participant and team projections. The rules do not require duplicated tenant
role claims: this avoids stale claim refreshes delaying membership revocation.
They do require the membership role list to be well formed and fail closed when
the deterministic membership document is missing or malformed.

## Migration, deployment, verification, and rollback

1. Inventory legacy profiles with `npm run migrate:memberships:verify`; do not
   translate `super_admin` to `platform_super_admin`. Deploy the API first with
   `MEMBERSHIP_ENFORCEMENT_MODE=compatibility`, then deploy the reviewed rules.
2. Have each eligible zero-membership legacy administrator call the authenticated
   bootstrap endpoint once. Verify the organization, deterministic
   `{organizationId}_{uid}` membership, migration marker, audit events, session
   `authorization.source`, and a forced-token-refresh login before enabling the
   tenant. Run `npm run test:rules`, `npm run test:integration`, and a cross-tenant
   API smoke test against the emulators and staging.
3. After the migration inventory reaches zero, set
   `MEMBERSHIP_ENFORCEMENT_MODE=strict`. Remove legacy profile roles only after a
   retained audit export and rollback snapshot. Provision platform operators
   separately, with a two-person review and an audit record.
4. To roll back, restore the previous rules and API artifact together, return the
   feature flag to `compatibility`, revoke any newly provisioned platform claims
   and refresh/revoke their tokens, then restore affected organization,
   membership, migration, and audit documents from the pre-deployment backup.
   Never roll back by granting global claims to tenant super-administrators or by
   enabling browser writes.

The typed permission catalog and complete role mapping live in `src/auth/policy.ts`. In summary:

Capability-driven frontend menu visibility is audited separately in
[`menu-visibility-guide.md`](./menu-visibility-guide.md). That guide also records
the current differences between UI capabilities, personas, and the lower-level
permission roles described here.

| Role                 | Permissions                                                                                       | Required relationship/scope                            |
| -------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| child                | self journey, check-in, character, Bible, reading, project and points; composite team progress    | UID owns active participant in membership organization |
| parent               | linked child summary, own/linked observations, family, support, linked report, composite progress | active same-organization parent-child link             |
| mentor               | assigned team, project guidance, assigned reading, encouragement, composite progress              | active same-organization mentor assignment             |
| observer             | create granted observations; read own granted observations                                        | active, unrevoked, unexpired participant grant         |
| admin                | program/configuration/content/quarter/team/participant/scoped reports                             | active membership and assigned program                 |
| super_admin          | all admin permissions plus organization/membership/role/invitation/consent/audit                  | active membership in the target organization           |
| platform_super_admin | cross-tenant operator administration                                                              | explicit claim and explicit target organization        |

Parents receive summary DTOs, not raw check-ins, reflections, surveys, Bible answers, or mentoring notes. No listed role can alter point/audit history, impersonate a child, or trust a client-selected relationship ID.

## Operational constraints

Super-admin assignment requires an existing tenant super-admin (or protected bootstrap), explicit organization, reason, expected membership version, audit event, claims synchronization, and client token refresh. Removal must reject a version conflict and removal of the final active tenant super-admin. These lifecycle workflows remain server-only.
