// Generated from openapi.yaml by npm run openapi:types. Do not edit.
export interface ParentPage<T> {
  data: T[];
  meta: { nextCursor: string | null };
}

export interface ParentResource<T> { data: T }

export interface CalculatedSource {
  calculatedAt: string;
  sourceQuarterId: string | null;
  sourceWeekId: string | null;
}

export interface ParentChildSummary extends CalculatedSource {
  id: string;
  approvedDisplayName: string;
  status: "active" | "pending" | "inactive";
  team: { id: string; displayName: string } | null;
  quarter: { id: string; name: string } | null;
  weeklyParticipation: { completed: number; available: number };
  readingProgress: { completed: number; assigned: number };
  projectStatus: string | null;
}
