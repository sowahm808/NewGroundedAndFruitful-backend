# Emulator workflow seed

`npm run seed` creates a safe, repeatable local dataset shaped around the product workflow in `docs/reference/Grounded_Fruitful_Product_Flow_and_Contract_Final(2).docx`. The command refuses to run unless both the Auth and Firestore emulators are configured.

The fixture includes two organizations for cross-tenant checks; linked and empty-state parents; active, unrelated, and suspended children; assigned mentor and observer scopes; administrator and super-administrator identities; an open twelve-week quarter plus draft and archived lifecycle examples; teams, five character qualities, Bible and reading activities, a project with milestone and update, observations, consent, survey, report policy, point rules, and aggregate totals.

## Adult emulator sign-in

All seeded email/password identities use the emulator-only password `Grounded1!`.

| Journey            | Email                           | Important fixture state           |
| ------------------ | ------------------------------- | --------------------------------- |
| Linked parent      | `parent-1@example.test`         | Linked only to Avery              |
| Empty-state parent | `parent-empty-1@example.test`   | No linked children                |
| Mentor             | `mentor-1@example.test`         | Assigned only to Growing Oaks     |
| Observer           | `observer-1@example.test`       | Dated observation grant for Avery |
| Admin              | `admin-1@example.test`          | Grounded & Fruitful Demo Program  |
| Super admin        | `super-admin-1@example.test`    | Organization-scoped super admin   |
| Neighbor admin     | `neighbor-admin-1@example.test` | Separate tenant denial fixture    |

The child identities also have emails for Auth-emulator diagnostics, but the product child journey should use `POST /api/v1/auth/child-login`:

| State                | Family code | Handle      | PIN    |
| -------------------- | ----------- | ----------- | ------ |
| Active child (Avery) | `FAMILY1`   | `sprout`    | `2468` |
| Suspended membership | `FAMILY1`   | `suspended` | `2468` |
| Other tenant         | `NEIGHBOR`  | `seedling`  | `2468` |

## Privacy and authorization checks

The second child's private check-in and survey response contain values prefixed with `PRIVATE_CANARY_`. They are deliberately conspicuous test data: child, team, mentor, observer, and unrelated-parent responses must never contain them. Team APIs should expose only the seeded composite total, never either participant's contribution.

Seed dates are anchored to the UTC day on which the command runs. This keeps the current quarter, character cycle, assignments, and dated grants usable while document IDs and scenario meanings remain stable. Running the seed again replaces the named fixtures without creating duplicates.
