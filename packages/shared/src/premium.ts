/**
 * D14 (Sean-approved): premium tier. Placeholder prices until IAP ships (CARD_FLOW_IAP_ENABLED off).
 * Batch grading and saved estimate history are premium-only. Free history keeps saving on the
 * server and shows once the user upgrades.
 */
import { GRADE_QUOTA_FREE_PER_MONTH, GRADE_QUOTA_PREMIUM_PER_MONTH } from "./grade-quota";

/** The one place the placeholder prices live. */
export const PREMIUM_PLACEHOLDER_PRICING = {
  monthly: "$6.99/month",
  yearly: "$59.99/year",
  premiumEstimatesPerMonth: GRADE_QUOTA_PREMIUM_PER_MONTH,
  freeEstimatesPerMonth: GRADE_QUOTA_FREE_PER_MONTH,
} as const;

export const PREMIUM_REQUIRED_CODE = "premium_required";
/**
 * Mobile Tech Lead review: the batch screen marks each estimate request with this header;
 * the API answers 403 premium_required to free accounts. Each estimate still uses quota.
 */
export const BATCH_GRADE_HEADER = "x-cardflow-batch";
export const PREMIUM_FEATURES = ["batch_grading", "grade_history"] as const;
export type PremiumFeature = (typeof PREMIUM_FEATURES)[number];

const FEATURE_LINE: Record<PremiumFeature, string> = {
  batch_grading: "Batch pre-grade is part of Premium.",
  grade_history: "Saved pre-grade estimate history is part of Premium. Your estimates are still being saved.",
};

export const PREMIUM_PROMPT_COPY = {
  title: "Premium is coming",
  plans: `${PREMIUM_PLACEHOLDER_PRICING.monthly} or ${PREMIUM_PLACEHOLDER_PRICING.yearly}`,
  includes: `${PREMIUM_PLACEHOLDER_PRICING.premiumEstimatesPerMonth} pre-grade estimates a month (free: ${PREMIUM_PLACEHOLDER_PRICING.freeEstimatesPerMonth}), batch pre-grade and saved estimate history.`,
  notYet: "Upgrades aren't available yet. Prices may change before launch.",
} as const;

export function premiumFeatureLine(feature: PremiumFeature): string {
  return FEATURE_LINE[feature];
}

export function isPremiumFeature(value: unknown): value is PremiumFeature {
  return typeof value === "string" && (PREMIUM_FEATURES as readonly string[]).includes(value);
}
