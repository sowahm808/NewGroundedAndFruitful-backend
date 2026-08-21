# Menu visibility by capability

This guide records which assignments currently produce the capabilities used to
show application menu items. It is an audit of the executable capability
projection in `src/auth/capabilities.ts`, not a proposal to infer access from a
route name or from a role label.

## Visibility matrix

| Menu item         | Required capability          | Assignment that currently receives it            | Current result              |
| ----------------- | ---------------------------- | ------------------------------------------------ | --------------------------- |
| Children          | `parent.children.read`       | `parent` persona                                 | Visible to a parent persona |
| Observations      | `parent.observations.create` | `parent` persona                                 | Visible to a parent persona |
| Family activities | `family.activities.read`     | `parent` persona                                 | Visible to a parent persona |
| Support requests  | `support.requests.create`    | `parent` persona                                 | Visible to a parent persona |
| Reports           | `parent.reports.read`        | `parent` persona                                 | Visible to a parent persona |
| Notifications     | `parent.notifications.read`  | None                                             | Hidden for every assignment |
| Quarters          | `admin.quarters.manage`      | `admin` workspace role or `admin` effective role | Visible to an admin         |
| Bible             | `admin.bible_content.manage` | `admin` workspace role or `admin` effective role | Visible to an admin         |

The Notifications result is intentional documentation of the current gap:
`parent.notifications.read` does not occur in the capability catalog, so the
backend cannot currently return it in a session. Adding a menu that checks for
that capability will keep the item hidden until the backend defines and assigns
the capability.

## How assignments combine

Capabilities are additive. A membership with both the `parent` persona and the
`admin` role receives the parent and admin capabilities, and therefore sees all
of the audited items except Notifications. The current combinations are:

| Active-workspace assignment                   | Parent menu items                                                    | Admin menu items | Notifications |
| --------------------------------------------- | -------------------------------------------------------------------- | ---------------- | ------------- |
| `parent` persona only                         | Children, Observations, Family activities, Support requests, Reports | None             | Hidden        |
| `admin` only                                  | None                                                                 | Quarters, Bible  | Hidden        |
| `parent` persona + `admin`                    | Children, Observations, Family activities, Support requests, Reports | Quarters, Bible  | Hidden        |
| `child`, `mentor`, or `observer` persona only | None                                                                 | None             | Hidden        |
| `owner` only                                  | None                                                                 | None             | Hidden        |
| `super_admin` only                            | None                                                                 | None             | Hidden        |
| `platform_super_admin` only                   | None                                                                 | None             | Hidden        |

There are two important distinctions behind this table:

1. `parent` is a persona for this menu projection. An `owner` is not implicitly
   a parent, although personal-workspace onboarding normally stores both
   `workspaceRoles: ["owner"]` and `personas: ["parent"]`.
2. The capability projection grants admin menu capabilities only when the
   active membership has the literal `admin` workspace role or effective role.
   It does not currently expand `super_admin` or `platform_super_admin` into
   these UI capabilities. This differs from the lower-level permission policy,
   where super-admin roles include admin permissions, and is a compatibility
   gap to resolve deliberately rather than in frontend code.

## Frontend implementation rule

Render each menu item by checking the exact required value in the authenticated
session's `capabilities` array. Do not derive visibility from `role`, `roles`,
`effectiveRoles`, persona names, ownership, or the apparent privilege hierarchy.
For example:

```ts
const canSeeChildren = session.capabilities.includes("parent.children.read");
```

Recompute navigation when the active workspace or refreshed session changes.
Capabilities come from the active membership only, so a capability held in one
workspace must not make a menu visible while another workspace is active.

Menu visibility is navigation behavior, not authorization. The API must still
enforce capability, active membership, tenant scope, and resource relationship;
hiding a menu item neither grants nor revokes access.

## Audit follow-ups

- Decide whether Notifications should be removed from the menu contract or add
  `parent.notifications.read` to the parent persona after a corresponding API
  authorization contract exists.
- Decide whether `super_admin` and `platform_super_admin` should receive admin
  UI capabilities. If so, change and test the backend projection rather than
  special-casing those roles in the client.
- Test navigation using the session capability array for every row in the
  matrix, including active-workspace changes and mixed parent/admin membership.
