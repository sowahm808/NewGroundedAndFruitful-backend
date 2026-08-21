import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const source = await readFile(
  new URL("../openapi.yaml", import.meta.url),
  "utf8",
);
const document = parse(source);
const required = {
  "/auth/onboarding/personal-workspace": ["post"],
  "/auth/onboarding/organization": ["post"],
  "/admin/quarters": ["get", "post"],
  "/admin/quarters/{quarterId}": ["get", "patch"],
  "/admin/quarters/{quarterId}/activate": ["post"],
  "/admin/quarters/{quarterId}/close": ["post"],
  "/admin/quarters/{quarterId}/archive": ["post"],
  "/admin/bible-content/imports": ["post"],
  "/admin/bible-content/imports/{importId}": ["get"],
  "/admin/bible-content/imports/{importId}/items/{itemId}": ["patch"],
  "/admin/bible-content/imports/{importId}/validate": ["post"],
  "/admin/bible-content/imports/{importId}/commit": ["post"],
  "/admin/bible-content": ["get"],
  "/admin/bible-content/{contentSetId}": ["get", "patch"],
  "/admin/bible-content/{contentSetId}/publish": ["post"],
  "/admin/bible-content/{contentSetId}/archive": ["post"],
  "/child/bible": ["get"],
  "/child/bible/history": ["get"],
  "/child/bible/{activityId}/draft": ["put"],
  "/child/bible/{activityId}/complete": ["post"],
};
for (const [path, methods] of Object.entries(required)) {
  for (const method of methods) {
    if (!document.paths?.[path]?.[method])
      throw new Error(`OpenAPI is missing ${method.toUpperCase()} ${path}`);
  }
}
for (const schema of [
  "Quarter",
  "QuarterCreate",
  "QuarterUpdate",
  "QuarterLifecycle",
  "QuarterResponse",
  "QuarterListResponse",
]) {
  if (!document.components?.schemas?.[schema])
    throw new Error(`OpenAPI is missing the ${schema} schema`);
}
const childSchema = JSON.stringify(
  document.components.schemas.ChildBibleResponse,
);
if (
  childSchema.includes("correctChoiceId") ||
  childSchema.includes("correctCount")
)
  throw new Error(
    "Child Bible OpenAPI schema exposes protected correctness data",
  );
console.log("Verified the published quarter OpenAPI contract.");
