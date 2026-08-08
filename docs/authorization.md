# Authorization

Roles are child, parent, mentor, observer, admin, and super_admin. Claims provide coarse authorization only. `parentChildLinks`, active team membership, and explicit observer grants provide resource authorization. Shared helpers enforce authentication, roles, parent-child links, mentor-team links, and administrative boundaries. Admin SDK code must invoke these checks because Firestore Rules do not constrain privileged server access.
