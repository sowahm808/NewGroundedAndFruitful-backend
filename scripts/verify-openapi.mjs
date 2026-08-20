import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const source = await readFile(
  new URL("../openapi.yaml", import.meta.url),
  "utf8",
);
const document = parse(source);
const required = {
  "/admin/quarters": ["get", "post"],
  "/admin/quarters/{quarterId}": ["get", "patch"],
  "/admin/quarters/{quarterId}/activate": ["post"],
  "/admin/quarters/{quarterId}/close": ["post"],
  "/admin/quarters/{quarterId}/archive": ["post"],
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
console.log("Verified the published quarter OpenAPI contract.");
