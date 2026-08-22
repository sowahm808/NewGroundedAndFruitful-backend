import { describe, expect, it } from "vitest";
import { normalizeRequestError } from "../src/app.js";

describe("dependency error contract", () => {
  it.each(["unavailable", "deadline-exceeded", 14])(
    "maps provider failure %s to the stable 503 contract",
    (code) => {
      const error = normalizeRequestError(
        Object.assign(new Error("private provider detail"), { code }),
      );
      expect(error).toMatchObject({
        status: 503,
        code: "DEPENDENCY_UNAVAILABLE",
        message: "A required data service is temporarily unavailable.",
      });
      expect(error.message).not.toContain("private provider detail");
    },
  );

  it("does not misclassify arbitrary application failures", () => {
    expect(normalizeRequestError(new Error("bug"))).toMatchObject({
      status: 500,
      code: "INTERNAL",
    });
  });
});
