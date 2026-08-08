# Backend architecture

The application uses thin Firebase Functions v2 adapters, schema-validated DTOs, application/domain services, authorization helpers, and Admin SDK repositories. Features remain independently organized under `src`. The current foundation implements authorization, points, character, Bible and projects; additional endpoints must follow the same boundaries. No client value controls identity, role, team, award amount, or approval state.
