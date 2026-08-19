import { rm } from "node:fs/promises";
import { resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "lib");
const relativeOutput = relative(root, output);

if (relativeOutput !== "lib") {
  throw new Error(`Refusing to clean unexpected path: ${output}`);
}

await rm(output, { recursive: true, force: true });
