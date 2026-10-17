# D14 premium (placeholder)

- **Prices (placeholder, no IAP yet):** $6.99/month or $59.99/year. Single constant: `PREMIUM_PLACEHOLDER_PRICING` in `packages/shared/src/premium.ts`.
- **Pre-grade estimates:** free 5 a month, premium 30.
- **Reset date:** each user's own date. That's the billing date once billing exists (`grade_accounts.billing_anchor_at`), otherwise the account creation date (`anchor_at`, set when the account is first seen). Days past the end of a short month clamp, so a 31st anchor resets on Feb 28/29. Not the calendar month.
- **No rollover:** unused estimates don't roll over. **Purchased extra credits also reset monthly.** They belong to the period they were bought in (`credits_period`) and are void at the next reset. Constants: `estimatesRollOver: false`, `creditsRollOver: false`.
- **Estimate history:** free accounts see their **10 most recent** estimates per card. Older ones stay saved on the server ("N older estimates saved, not deleted. Upgrade to see them."). Premium sees the full history. Importing old on-phone history is premium-only (403 `premium_required`); on a free account the phone keeps its copy.
- **Batch pre-grade:** premium-only. The batch screen checks `POST /v1/grading/batch` (a premium check that runs nothing), and each estimate still spends quota.
- **App:** the quota caption ends with "Resets Nov 15", and the out-of-estimates hint says nothing rolls over.
- **Rollout note:** usage rows are now keyed by period start date (`YYYY-MM-DD`) instead of `YYYY-MM`, so everyone gets a fresh allowance at deploy.
