/**
 * D14 (Sean-approved): premium tier. Placeholder prices until IAP ships
 * (`CARD_FLOW_IAP_ENABLED` / `EXPO_PUBLIC_CARD_FLOW_IAP_ENABLED` off).
 * Batch grading and full estimate history are premium-only. Free users see their 10 most recent
 * estimates per card; older ones keep saving on the server and show once the user upgrades.
 * Monthly allowances reset on the 1st of each month (UTC; the billing date once Apple billing exists) and don't roll over.
 * Bought credit packs never expire (Sean, Oct 16; Apple 3.1.1) and are spent after the allowance.
 */
import { GRADE_HISTORY_FREE_VISIBLE } from "./grade-history";
import { GRADE_QUOTA_FREE_PER_MONTH } from "./grade-quota";

/** The one place the placeholder prices live. */
export const PREMIUM_PLACEHOLDER_PRICING = {
  monthly: "$6.99/month",
  yearly: "$59.99/year",
  /** Sean (Oct 18): quick estimates are unlimited on Premium. */
  premiumEstimatesPerMonth: "unlimited" as const,
  freeEstimatesPerMonth: GRADE_QUOTA_FREE_PER_MONTH,
  /** Sean (Oct 18): allowances reset on the 1st of each month; unused estimates don't roll over. */
  estimatesRollOver: false,
  /** Sean (Oct 16): bought credit-pack credits never expire (Apple 3.1.1). */
  creditsExpire: false,
  /**
   * Credit packs (Sean, Oct 16): buying is Premium-only, built after the Apple developer account
   * exists. Sean (Oct 17): spending leftover credits does not need Premium; on Free they're
   * spent after the 10 free estimates.
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
  "Free accounts get 10 quick pre-grade estimates a month, resetting on the 1st of each month, and see their 10 most recent estimates per card. Older estimates stay saved, not deleted.";

export const PREMIUM_REQUIRED_CODE = "premium_required";
/**
 * Mobile Tech Lead review: the batch screen marks each estimate request with this header;
 * the API answers 403 premium_required to free accounts. Each estimate still uses quota.
 */
export const BATCH_GRADE_HEADER = "x-cardflow-batch";
export const PREMIUM_FEATURES = ["batch_grading", "grade_history", "credit_packs", "livestream_scanner"] as const;
export type PremiumFeature = (typeof PREMIUM_FEATURES)[number];

const FEATURE_LINE: Record<PremiumFeature, string> = {
  batch_grading: "Batch pre-grade is part of Premium.",
  credit_packs: "Credit packs are for Premium members.",
  grade_history: `Your full pre-grade estimate history is part of Premium. Free accounts see the ${GRADE_HISTORY_FREE_VISIBLE} most recent; older ones stay saved.`,
  /** Sean (Oct 19): after the 3-day trial, prompt to subscribe (paywall in the app). */
  livestream_scanner: "Subscribe to Premium to keep using the livestream scanner.",
};

export const PREMIUM_PROMPT_COPY = {
  title: "Premium is coming",
  plans: `${PREMIUM_PLACEHOLDER_PRICING.monthly} or ${PREMIUM_PLACEHOLDER_PRICING.yearly}`,
  includes: `Unlimited quick pre-grade estimates (free: ${PREMIUM_PLACEHOLDER_PRICING.freeEstimatesPerMonth} a month), batch pre-grade and full estimate history. Your monthly allowance resets on your reset date and unused monthly estimates don't roll over. Credits you buy never expire.`,
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
  /** Sean (Oct 17): leftover credits stay usable if Premium ends; only buying needs Premium. */
  afterPremium: "If your Premium ends, credits you already bought still work. They're used after your free monthly estimates.",
} as const;


/**
 * Sean (Oct 19): paywall after the livestream 3-day trial ends.
 * IAP is not live yet (no Apple Developer account / StoreKit / RevenueCat; Expo Go only).
 * `startPremiumPurchase()` is the single entry point; while IAP is off it only shows
 * `openingSoon`. When `EXPO_PUBLIC_CARD_FLOW_IAP_ENABLED` is on, the paywall must show
 * price, period, auto-renew terms, Restore Purchases, and Terms/Privacy (Apple 3.1.2).
 */
export const LIVESTREAM_PAYWALL_COPY = {
  title: "Your 3-day livestream trial has ended",
  body: "Subscribe to Premium to keep using the livestream scanner.",
  subscribe: "Subscribe to Premium",
  notNow: "Not now",
  openingSoon: "Subscriptions are opening soon.",
  /** Shown only when IAP is enabled (Apple 3.1.2). Prices stay placeholders until StoreKit is wired. */
  plans: `${PREMIUM_PLACEHOLDER_PRICING.monthly} or ${PREMIUM_PLACEHOLDER_PRICING.yearly}`,
  autoRenew:
    "Premium renews automatically unless you cancel at least 24 hours before the end of the current period. Manage or cancel in your Apple ID Account Settings.",
  restore: "Restore Purchases",
  terms: "Terms of Use",
  privacy: "Privacy Policy",
  purchaseNotConnected: "Purchases aren't connected yet.",
} as const;

/**
 * Placeholder legal URLs for the IAP-on paywall. Replace with the published pages before
 * turning on `CARD_FLOW_IAP_ENABLED` / `EXPO_PUBLIC_CARD_FLOW_IAP_ENABLED`.
 */
export const PREMIUM_LEGAL_URLS = {
  terms: "https://pokesniper.app/terms",
  privacy: "https://pokesniper.app/privacy",
} as const;


/** True when the IAP flag string is an explicit on value (`true` / `1`). */
export function premiumIapEnabledFromEnv(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "true" || value === "1";
}

export function premiumFeatureLine(feature: PremiumFeature): string {
  return FEATURE_LINE[feature];
}

export function isPremiumFeature(value: unknown): value is PremiumFeature {
  return typeof value === "string" && (PREMIUM_FEATURES as readonly string[]).includes(value);
}
