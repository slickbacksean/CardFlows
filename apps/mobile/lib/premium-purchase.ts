/**
 * Single entry point for Premium subscription purchase / restore.
 *
 * Sean (Oct 19): livestream trial paywall calls this. In-app purchases are not live yet —
 * no Apple Developer account, no StoreKit / RevenueCat, Expo Go only (no new native modules).
 *
 * Flags (both off by default):
 * - API: `CARD_FLOW_IAP_ENABLED`
 * - App: `EXPO_PUBLIC_CARD_FLOW_IAP_ENABLED` (`true` / `1`)
 *
 * TODO: When the Apple account exists, wire StoreKit 2 (or RevenueCat) here:
 *   1. Load products and show store prices (not placeholders) on the paywall.
 *   2. Purchase / Restore update `grade_accounts.plan` via a verified server receipt.
 *   3. Keep Apple 3.1.2 disclosures on the paywall (price, period, auto-renew, Restore,
 *      Terms, Privacy). See docs/LIVESTREAM_TRIAL.md and docs/PREMIUM_D14.md.
 */
import { LIVESTREAM_PAYWALL_COPY, premiumIapEnabledFromEnv } from "@cardflow/shared";

export type PremiumPurchaseResult =
  | { ok: true }
  | {
      ok: false;
      reason: "iap_disabled" | "not_connected" | "cancelled" | "failed";
      message: string;
    };

/** App-side IAP gate. Mirrors server `CARD_FLOW_IAP_ENABLED`. Off unless explicitly true/1. */
export function isPremiumIapEnabled(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  return premiumIapEnabledFromEnv(env.EXPO_PUBLIC_CARD_FLOW_IAP_ENABLED);
}

/**
 * Start a Premium subscription purchase.
 * While IAP is off: returns `openingSoon` only — no fake checkout.
 */
export async function startPremiumPurchase(): Promise<PremiumPurchaseResult> {
  if (!isPremiumIapEnabled()) {
    return { ok: false, reason: "iap_disabled", message: LIVESTREAM_PAYWALL_COPY.openingSoon };
  }
  // TODO(StoreKit/RevenueCat): present the subscription sheet and verify the receipt server-side.
  return {
    ok: false,
    reason: "not_connected",
    message: LIVESTREAM_PAYWALL_COPY.purchaseNotConnected,
  };
}

/**
 * Restore prior Premium purchases. Only call from UI when IAP is enabled
 * (Restore Purchases is hidden while the flag is off).
 */
export async function restorePremiumPurchases(): Promise<PremiumPurchaseResult> {
  if (!isPremiumIapEnabled()) {
    return { ok: false, reason: "iap_disabled", message: LIVESTREAM_PAYWALL_COPY.openingSoon };
  }
  // TODO(StoreKit/RevenueCat): restore transactions and sync plan on the server.
  return {
    ok: false,
    reason: "not_connected",
    message: LIVESTREAM_PAYWALL_COPY.purchaseNotConnected,
  };
}
