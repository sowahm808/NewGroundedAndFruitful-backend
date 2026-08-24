// Generated from openapi.yaml by npm run openapi:types. Do not edit.
export type QuarterStatus = "draft" | "open" | "closed" | "archived";
export type QuarterAllowedAction = "view" | "edit" | "activate" | "close" | "archive";

export interface QuarterWorkspace {
  id: string;
  name: string;
  type: "organization";
}

export interface Quarter {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  status: QuarterStatus;
  /** @deprecated Use workspace.id. Preserved for backward compatibility. */
  organizationId: string;
  workspace: QuarterWorkspace;
  allowedActions: QuarterAllowedAction[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  version: number;
}

export interface QuarterListResponse {
  data: {
    items: Quarter[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  };
}
