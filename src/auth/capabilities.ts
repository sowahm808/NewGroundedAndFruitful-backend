export const productPersonas = [
  "child",
  "parent",
  "mentor",
  "observer",
] as const;
export type ProductPersona = (typeof productPersonas)[number];

export const personaCapabilities: Readonly<
  Record<ProductPersona, readonly string[]>
> = {
  child: ["child.journey.read", "child.journey.update"],
  parent: [
    "parent.dashboard.read",
    "parent.children.read",
    "parent.observations.create",
    "family.activities.read",
    "support.requests.create",
    "parent.reports.read",
    "parent.consent.manage",
  ],
  mentor: ["mentor.teams.read", "mentor.observations.create"],
  observer: ["observer.observations.create"],
};

export const adminCapabilities = [
  "admin.quarters.manage",
  "admin.bible_content.manage",
  "admin.point_rules.manage",
  "admin.teams.manage",
  "admin.memberships.manage",
  "admin.reports.read",
] as const;

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
  // `owner` is deliberately absent: ownership is governance, not admin authority.
  if (workspaceRoles.includes("admin") || roles.includes("admin"))
    derived.push(...adminCapabilities);
  return [...new Set(derived)];
}
