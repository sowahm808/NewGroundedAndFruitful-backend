import { describe, expect, it } from "vitest";
import { gratitudeSchema, surveySubmissionSchema } from "../src/child/schemas.js";

describe("child journey schemas", () => {
  it("keeps gratitude private in a bounded JSON body", () => {
    expect(gratitudeSchema.parse({ text: "I am thankful" })).toEqual({ text: "I am thankful" });
    expect(gratitudeSchema.safeParse({ text: "" }).success).toBe(false);
  });
  it("accepts rating boundary-like survey values and rejects duplicate answers", () => {
    expect(surveySubmissionSchema.safeParse({ status: "completed", answers: [{ questionId: "q", value: 0 }] }).success).toBe(true);
    expect(surveySubmissionSchema.safeParse({ status: "completed", answers: [{ questionId: "q", value: 10 }] }).success).toBe(true);
    expect(surveySubmissionSchema.safeParse({ status: "draft", answers: [{ questionId: "q", value: 1 }, { questionId: "q", value: 2 }] }).success).toBe(false);
  });
});
