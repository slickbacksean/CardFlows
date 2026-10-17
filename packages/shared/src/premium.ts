/**
 * D14 (Sean-approved): premium tier. Placeholder prices until IAP ships (CARD_FLOW_IAP_ENABLED off).
 * Batch grading and full estimate history are premium-only. Free users see their 10 most recent
 * estimates per card; older ones keep saving on the server and show once the user upgrades.
 * The monthly allowance resets on the user's own date (billing date) and doesn't roll over.
 * Bought credit packs never expire (Sean, Oct 16; Apple 3.1.1) and are spent after the allowance.
 */
import { GRADE_HISTORY_FREE_VISIBLE } from "./grade-history";
import { GRADE_QUOTA_FREE_PER_MONTH, GRADE_QUOTA_PREMIUM_PER_MONTH } from "./grade-quota";

/** The one place the placeholder prices live. */
export const PREMIUM_PLACEHOLDER_PRICING = {
  monthly: "$6.99/month",
  yearly: "$59.99/year",
  premiumEstimatesPerMonth: GRADE_QUOTA_PREMIUM_PER_MONTH,
  freeEstimatesPerMonth: GRADE_QUOTA_FREE_PER_MONTH,
  /** Sean: allowances reset monthly on the user's own date; unused estimates don't roll over. */
  estimatesRollOver: false,
  /** Sean (Oct 16): bought credit-pack credits never expire (Apple 3.1.1). */
  creditsExpire: false,
  /**
   * Credit packs (Sean, Oct 16): Premium-only, built after the Apple developer account exists.
   * Not for sale yet. Credits are spent only after the monthly allowance is used up.
   */
  creditPacks: [
    { credits: 10, price: "$2.99" },
    { credits: 25, price: "$5.99" },
  ],
  freeHistoryVisible: GRADE_HISTORY_FREE_VISIBLE,
} as const;

/** Shown on the sign-up screen. */
export const SIGNUP_ALLOWANCE_NOTE =
  "Free accounts get 5 pre-grade estimates a month, resetting on your monthly reset date, and see their 10 most recent estimates per card. Older estimates stay saved, not deleted.";

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
  grade_history: `Your full pre-grade estimate history is part of Premium. Free accounts see the ${GRADE_HISTORY_FREE_VISIBLE} most recent; older ones stay saved.`,
};

export const PREMIUM_PROMPT_COPY = {
  title: "Premium is coming",
  plans: `${PREMIUM_PLACEHOLDER_PRICING.monthly} or ${PREMIUM_PLACEHOLDER_PRICING.yearly}`,
  includes: `${PREMIUM_PLACEHOLDER_PRICING.premiumEstimatesPerMonth} pre-grade estimates a month (free: ${PREMIUM_PLACEHOLDER_PRICING.freeEstimatesPerMonth}), batch pre-grade and full estimate history. The monthly allowance resets on your billing date and doesn't roll over.`,
  notYet: "Upgrades aren't available yet. Prices may change before launch.",
} as const;

/**
 * For the credit-pack screen once packs ship (after the Apple account). Not shown yet: packs
 * aren't for sale, so the app doesn't mention them until purchases are live.
 */
export const CREDIT_PACK_COPY = {
  premiumOnly: "Credit packs are for Premium members.",
  packs: PREMIUM_PLACEHOLDER_PRICING.creditPacks.map((p) => `${p.credits} pre-grade estimates for ${p.price}`),
  neverExpire: "Bought credits never expire. They're used only after your monthly pre-grade estimates run out.",
} as const;

export function premiumFeatureLine(feature: PremiumFeature): string {
  return FEATURE_LINE[feature];
}

export function isPremiumFeature(value: unknown): value is PremiumFeature {
  return typeof value === "string" && (PREMIUM_FEATURES as readonly string[]).includes(value);
}
