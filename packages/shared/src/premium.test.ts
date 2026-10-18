import { describe, expect, it } from "vitest";
import { CREDITS_NEVER_EXPIRE_COPY, GRADE_QUOTA_COPY } from "./grade-quota";
import { CREDIT_PACK_COPY, PREMIUM_PLACEHOLDER_PRICING, PREMIUM_PROMPT_COPY, premiumFeatureLine } from "./premium";

describe("D14 premium", () => {
  it("placeholder prices and limits", () => {
    expect(PREMIUM_PLACEHOLDER_PRICING).toMatchObject({ monthly: "$6.99/month", yearly: "$59.99/year", premiumEstimatesPerMonth: "unlimited", freeEstimatesPerMonth: 10 });
    expect(PREMIUM_PROMPT_COPY.plans).toBe("$6.99/month or $59.99/year");
    expect(PREMIUM_PLACEHOLDER_PRICING).toMatchObject({ estimatesRollOver: false, creditsExpire: false, freeHistoryVisible: 10 });
    expect(PREMIUM_PLACEHOLDER_PRICING.creditPacks).toEqual([
      { credits: 10, price: "$2.99" },
      { credits: 25, price: "$5.99" },
    ]);
    expect(PREMIUM_PROMPT_COPY.includes.endsWith(CREDITS_NEVER_EXPIRE_COPY)).toBe(true);
    expect(PREMIUM_PROMPT_COPY.includes).not.toMatch(/credits reset|credits don't roll over/i);
  });
  it("prompt copy makes no profit, AI or grading-company claims", () => {
    const text = [...Object.values(PREMIUM_PROMPT_COPY), premiumFeatureLine("batch_grading"), premiumFeatureLine("grade_history")].join(" ");
    expect(text).not.toMatch(/profit|earn|money back|guarantee|\bAI\b|PSA|BGS|CGC|official grade|worth more|flip/i);
    expect(text).toMatch(/pre-grade estimate/i);
  });

  it("bought credits never expire (Sean, Oct 16); only the monthly allowance resets", () => {
    expect(CREDIT_PACK_COPY).toEqual({
      premiumOnly: "Credit packs are for Premium members.",
      packs: ["10 pre-grade estimates for $2.99", "25 pre-grade estimates for $5.99"],
      neverExpire: "Bought credits never expire. They're used only after your monthly pre-grade estimates run out.",
      afterPremium: "If your Premium ends, credits you already bought still work. They're used after your free monthly estimates.",
    });
    expect(premiumFeatureLine("credit_packs")).toBe("Credit packs are for Premium members.");
    expect(CREDITS_NEVER_EXPIRE_COPY).toBe(
      "Your monthly allowance resets on your reset date and unused monthly estimates don't roll over. Credits you buy never expire.",
    );
    expect(GRADE_QUOTA_COPY.outOfGradesHint).toBe(CREDITS_NEVER_EXPIRE_COPY);
    const shipped = [...Object.values(PREMIUM_PROMPT_COPY), ...Object.values(GRADE_QUOTA_COPY), ...Object.values(CREDIT_PACK_COPY).flat()].join(" ");
    expect(shipped).not.toMatch(/credits? (reset|expire at|don't roll over|are void)|credits don't roll/i);
    expect(Object.values(CREDIT_PACK_COPY).flat().join(" ")).not.toMatch(/profit|earn|\bAI\b|PSA|BGS|CGC|official grade/i);
  });
});
