import { BusinessRuleError } from "../shared/errors.js";
import type { AwardRequest, PointRule } from "./domain.js";
import { completionAward } from "./domain.js";
import { PointRepository } from "./repository.js";
export class PointService {
  constructor(private readonly repository: PointRepository) {}
  async awardCompletion(input: AwardRequest, rule: PointRule) {
    const points = completionAward(rule, input);
    if (points <= 0)
      throw new BusinessRuleError(
        "POINT_RULE_INELIGIBLE",
        "This completion is not eligible for points.",
      );
    return this.repository.award(input, points);
  }
}
