# Livestream scanner trial (Sean, Oct 18–19)

## Access

| State | Who | Behavior |
|---|---|---|
| **trial** | Signed-in, 18+, within 3 days of **account creation** | Scanner works; app shows days left |
| **locked** | Trial over, not Premium | Identify/guesses → 403 `premium_required` / `livestream_scanner`. App shows a **subscribe paywall**: title *Your 3-day livestream trial has ended*, body asking to subscribe to Premium, **Subscribe to Premium** + **Not now**. |
| **premium** | `grade_accounts.plan = premium` or `CARD_FLOW_PREMIUM_USER_IDS` | Unlocked |

The trial clock is `user_accounts.created_at + 3 days`. It does **not** start on first scanner use or overlay guesses. Existing accounts are measured from their original creation time. Invited/dev users without a `user_accounts` row use the grade-account first-seen anchor as a stand-in.

## Paywall and IAP

- Single purchase entry point: `startPremiumPurchase()` in `apps/mobile/lib/premium-purchase.ts` (restore: `restorePremiumPurchases()`).
- Flags (both **off** by default):
  - API: `CARD_FLOW_IAP_ENABLED`
  - App: `EXPO_PUBLIC_CARD_FLOW_IAP_ENABLED` (`true` / `1`)
- While IAP is off, Subscribe only shows *Subscriptions are opening soon.* — no fake checkout, no StoreKit, no new native modules (Expo Go only).
- When IAP is on, the paywall must show **price**, **billing period**, **auto-renew terms**, **Restore Purchases**, and links to **Terms** / **Privacy** (Apple 3.1.2). Restore is hidden while IAP is off.
- **TODO:** wire StoreKit 2 or RevenueCat into `startPremiumPurchase` / `restorePremiumPurchases` after the Apple Developer account exists; verify receipts server-side and set `grade_accounts.plan`. Until then, enabling the flag still returns *Purchases aren't connected yet.* Placeholders: `PREMIUM_PLACEHOLDER_PRICING`, `PREMIUM_LEGAL_URLS` (publish real Terms/Privacy URLs before enabling IAP).

## Endpoints

- `GET /v1/livestream/access` — status and days left. Requires signed-in + 18+. Does not mutate anything.
- `POST /v1/livestream/identify` and `GET /v1/livestream/guesses/:tcgdexId` — enforce trial/premium (same window as `/access`). 403 body uses `premiumFeatureLine("livestream_scanner")`.

## CardSight

Livestream frames stay **in-house** (OpenCLIP / pHash). They never go to CardSight, so **no CardSight consent check** on these routes. Documented for Policy Reviewer: third-party stream frames are not uploaded to CardSight.

## Storage

No separate trial table. Migration `0026_livestream_trials` created one; `0027_drop_livestream_trials` removes it. The window is derived from `user_accounts.created_at`.
