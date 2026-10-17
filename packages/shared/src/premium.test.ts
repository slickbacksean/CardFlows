import { describe, expect, it } from "vitest";
import { PREMIUM_PLACEHOLDER_PRICING, PREMIUM_PROMPT_COPY, premiumFeatureLine } from "./premium";

describe("D14 premium", () => {
  it("placeholder prices and limits", () => {
    expect(PREMIUM_PLACEHOLDER_PRICING).toMatchObject({ monthly: "$6.99/month", yearly: "$59.99/year", premiumEstimatesPerMonth: 30, freeEstimatesPerMonth: 5 });
    expect(PREMIUM_PROMPT_COPY.plans).toBe("$6.99/month or $59.99/year");
    expect(PREMIUM_PLACEHOLDER_PRICING).toMatchObject({ estimatesRollOver: false, creditsRollOver: false, freeHistoryVisible: 10 });
    expect(PREMIUM_PROMPT_COPY.includes).toMatch(/don't roll over/);
  });
  it("prompt copy makes no profit, AI or grading-company claims", () => {
    const text = [...Object.values(PREMIUM_PROMPT_COPY), premiumFeatureLine("batch_grading"), premiumFeatureLine("grade_history")].join(" ");
    expect(text).not.toMatch(/profit|earn|money back|guarantee|\bAI\b|PSA|BGS|CGC|official grade|worth more|flip/i);
    expect(text).toMatch(/pre-grade estimate/i);
  });
});
