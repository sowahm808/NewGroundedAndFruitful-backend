/**
 * Capabilities returned by the session contract. This is the sole projection
 * from active-workspace assignments to UI/API capabilities. Keep these grants
 * explicit: a wildcard would make it impossible to preserve tenant and
 * relationship boundaries when a new resource is introduced.
 */
export const productPersonas = [
  "admin",
  "child",
  "parent",
  "mentor",
  "observer",
] as const;
export type ProductPersona = (typeof productPersonas)[number];

export const adminCapabilities = [
  "admin.dashboard.read",
  "admin.participants.read",
  "admin.participants.manage",
  "admin.teams.read",
  "admin.teams.manage",
  "admin.assignments.read",
  "admin.assignments.manage",
  "admin.quarters.read",
  "admin.quarters.manage",
  "admin.character_content.read",
  "admin.character_content.manage",
  "admin.bible_content.read",
  "admin.bible_content.manage",
  "admin.family_activities.read",
  "admin.family_activities.manage",
  "admin.books.read",
  "admin.books.manage",
  "admin.projects.read",
  "admin.projects.manage",
  "admin.surveys.read",
  "admin.surveys.manage",
  "admin.point_rules.read",
  "admin.point_rules.manage",
  "admin.reports.read",
  "admin.awards.read",
  "admin.awards.manage",
  "admin.audit_summaries.read",
] as const;

export const tenantAdministrationCapabilities = [
  "tenant.memberships.read",
  "tenant.memberships.manage",
  "tenant.configuration.read",
  "tenant.configuration.manage",
  "tenant.administrators.read",
  "tenant.administrators.manage",
  "tenant.lifecycle.manage",
  "tenant.operations.read",
  "tenant.operations.manage",
  "tenant.audit.read",
] as const;

export const personaCapabilities: Readonly<
  Record<ProductPersona, readonly string[]>
> = {
  admin: adminCapabilities,
  child: [
    "child.today.read",
    "child.character.read",
    "child.character.update",
    "child.bible.read",
    "child.bible.update",
    "child.reading.read",
    "child.reading.update",
    "child.project.read",
    "child.project.update",
    "child.team.read",
    "child.points.read",
    "child.awards.read",
    // Compatibility capabilities used by the currently mounted child API.
    "child.journey.read",
    "child.journey.update",
  ],
  parent: [
    "parent.dashboard.read",
    "parent.children.read",
    "parent.observations.create",
    "parent.observations.read",
    "family.activities.read",
    "family.activities.complete",
    "support.requests.create",
    "support.requests.read",
    "parent.reports.read",
    "parent.notifications.read",
    "parent.consent.manage",
  ],
  mentor: [
    "mentor.teams.read",
    "mentor.participation_summaries.read",
    "mentor.reading_guidance.read",
    "mentor.project_guidance.read",
    "mentor.observations.create",
  ],
  observer: [
    "observer.subjects.read",
    "observer.observations.create",
    "observer.observations.read_own",
  ],
};

export function normalizePersonas(value: unknown): ProductPersona[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is ProductPersona =>
          typeof item === "string" &&
          (productPersonas as readonly string[]).includes(item),
      ),
    ),
  ];
}

export function deriveCapabilities(
  personas: readonly ProductPersona[],
  workspaceRoles: readonly string[],
  roles: readonly string[],
): string[] {
  const derived = personas.flatMap((persona) => personaCapabilities[persona]);
  const activeAssignments = new Set([...workspaceRoles, ...roles]);

  // `owner` is deliberately absent: ownership is governance, not an admin
  // persona and never creates platform-global or operational authority.
  if (activeAssignments.has("admin")) derived.push(...adminCapabilities);
  // super_admin is still tenant-scoped here: deriveCapabilities is called only
  // with the active membership's roles, never with global token claims.
  if (activeAssignments.has("super_admin"))
    derived.push(...adminCapabilities, ...tenantAdministrationCapabilities);

  return [...new Set(derived)];
}
