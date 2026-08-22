import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";

const specification = parse(
  await readFile(new URL("../openapi.yaml", import.meta.url), "utf8"),
);
const schemas = specification.components.schemas;
const values = (name) =>
  schemas[name].enum.map((value) => JSON.stringify(value)).join(" | ");
const output = `// Generated from openapi.yaml by npm run openapi:types. Do not edit.
export type QuarterStatus = ${values("QuarterStatus")};
export type QuarterAllowedAction = ${values("QuarterAllowedAction")};

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
`;

const target = new URL("../src/generated/quarter-contract.ts", import.meta.url);
await mkdir(new URL("../src/generated/", import.meta.url), { recursive: true });
await writeFile(target, output);
const parentOutput = `// Generated from openapi.yaml by npm run openapi:types. Do not edit.
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
`;
await writeFile(
  new URL("../src/generated/parent-contract.ts", import.meta.url),
  parentOutput,
);
console.log("Generated frontend quarter and Parent contract types.");
