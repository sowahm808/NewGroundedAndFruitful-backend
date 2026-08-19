import { describe, expect, it } from "vitest";
import { localDateIn } from "../src/child/context.js";
import childRouter from "../src/child/routes/index.js";

describe("child workflow contracts", () => {
  it("calculates dates in the organization IANA timezone across DST", () => {
    expect(localDateIn(new Date("2026-03-08T07:30:00Z"), "America/New_York")).toBe("2026-03-08");
    expect(localDateIn(new Date("2026-08-19T00:30:00Z"), "America/Los_Angeles")).toBe("2026-08-18");
  });
  it("registers all child route methods", () => {
    const routes=childRouter.stack.map(layer=>layer.route).filter(Boolean).map(route=>[Object.keys((route as unknown as {methods:Record<string,boolean>}).methods)[0],route?.path].join(" "));
    expect(routes).toEqual(expect.arrayContaining(["get /today","get /character","get /bible","get /reading","get /projects","get /team","post /check-ins/today/complete","post /projects/:projectId/updates"]));
  });
});
