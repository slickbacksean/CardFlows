# Max Buy Without a Live Pricing Provider

**Status:** Spike recommendation for review. **No pricing vendor integration. No live API keys.**  
**Related:** `MAX_BUY_CALCULATOR.md`, `ALL_IN_COST_MODEL.md`, `CRM_DATA_MODEL.md` §11, `MVP_SCOPE.md`, `NON_GOALS.md`.

---

## Legend

| Label | Meaning |
|-------|---------|
| **Confirmed** | Already decided in CardFlow product / mapping docs on `main`. |
| **Unconfirmed** | Depends on a later provider, legal review, or missing product spec. Do not invent. |
| **Assumption** | Spike recommendation pending founder decision. |

---

## 1. The problem

**Confirmed:** Pricing provider is **TBD** (`MVP_SCOPE.md` Validation item).

MVP **must** allow:
- Scan → Confirm → **Max Buy** → Purchased  
- Max Buy guidance from user-configured rules  
- CRM save with cost basis  

even when **no live pricing provider** is wired.

**Confirmed:** Do not invent a vendor API, do not scrape Whatnot/eBay/TCGplayer, and do not use TCGdex `pricing` as market data (`NON_GOALS.md`).

This document explains how Max Buy works in the **provider-less MVP path**.

---

## 2. User journey without a pricing provider

### 2.1 Happy path: user-entered reference

```
1. User scans a card (Manual Scan / Camera Photo)
2. CardSight returns candidate(s); user Confirms identity
3. CardFlow shows:
   - Catalog name, set, image (TCGdex cache)
   - "Enter a reference price" input
   - User's Max Buy rules (margin %, fees buffer)
4. User types a reference price: "$8.00"
5. CardFlow computes Max Buy: "$5.57" (guidance from rules)
6. User taps Purchased
7. User enters all-in cost (purchase price required; shipping/tax/fees/supplies optional)
8. CRM saves:
   - Inventory item (acquired)
   - Purchase row with all-in cost + Max Buy snapshot
   - Price snapshot (user_entered reference)
```

**No live pricing API.** User provides the comparable themselves.

### 2.2 Alternate path: no reference price

```
1–2. Same (scan, confirm)
3. CardFlow shows:
   - Catalog identity
   - "Enter a reference price" input
   - User's rules
4. User skips reference (leaves it blank)
5. Max Buy result: null
6. UI: "Enter a reference price to compute Max Buy."
7. User taps Purchased anyway (maybe they know the deal is good)
8. CRM saves:
   - Inventory item
   - Purchase with all-in cost
   - max_buy_amount: null
   - reference_price_amount: null
   - reference_price_source: "none"
```

**Confirmed:** CRM save is **not blocked** by missing Max Buy (`CRM_DATA_MODEL.md` §11).

### 2.3 Watchlist path: target Max Buy reminder

```
1–2. Same (scan, confirm)
3. User enters or skips reference
4. Max Buy computed or null
5. User taps Watchlist instead of Purchased
6. CRM saves:
   - Watchlist inventory item (watching)
   - target_max_buy_amount: computed guidance or user override
   - No purchase row, no all-in cost
```

Watchlist is interest, not a purchase.

---

## 3. Where the reference price comes from

**Assumption:**

| Source | `reference_price_source` | MVP? | Notes |
|--------|--------------------------|------|-------|
| User types it | `user_entered` | **Yes** | Primary path |
| Last `crm_price_snapshots` for this card | `user_entered` (previous) | **Yes** | "Use last reference: $8.00" button |
| **Later** pricing provider | `later_provider` | **Unconfirmed** | Validation item; do not invent fields |
| TCGdex `pricing` | — | **Never** | Catalog metadata, not market truth |
| CardSight | — | **Never** | Recognition-only provider |
| Scraped eBay/Whatnot/TCGplayer | — | **Never** | Non-goal; legal/technical risk |

When a pricing provider is chosen later:
- `pricing_provider_enabled` flag turns ON  
- Provider supplies `amount` + `currency` + `captured_at`  
- User may accept the estimate or override it  
- `reference_price_source` becomes `later_provider`  

Until then: **user-entered only**.

---

## 4. UI copy for missing reference

| Scenario | Max Buy result | UI text (example) | Action |
|----------|----------------|-------------------|--------|
| Reference exists | `$5.57` | "Based on your $8.00 reference, Max Buy: **$5.57**" | Show computed guidance |
| Reference null | `null` | "**Enter a reference price** to compute Max Buy." | Show input + rules; no computed number |

**Never** say:
- "No market data available" (implies we tried a live feed)  
- "CardFlow cannot estimate this card" (Max Buy is user math, not a CardFlow estimate)  
- "Pricing unavailable" (Max Buy ≠ pricing; it is guidance from user rules)  

**Say:**
- "Enter a reference price"  
- "Max Buy guidance will show when you add a reference"  
- "Your Max Buy rules: 20% margin, 13% fees buffer" (show rules so user understands what Max Buy will do)  

---

## 5. How to get a reference price (user guidance)

**Assumption:** Help text for MVP testers (not in-app hard-coded copy; likely a tooltip or onboarding).

Example guidance:

> CardFlow Max Buy is **your decision math**, not a live market feed. To compute Max Buy, enter a reference price you trust:
>
> - Recent sold listing you saw  
> - Shop price sticker  
> - Last price you recorded for this card  
> - Your own research  
>
> CardFlow applies **your** margin and fees rules to show guidance. You are not required to use Max Buy; you can buy at any price and save to CRM.

**Never** instruct users to:
- Scrape eBay / Whatnot  
- Use TCGdex pricing as a reference (it is not there)  
- Treat Max Buy as a vendor-guaranteed price  

---

## 6. Watchlist without a pricing provider

Watchlist stores `target_max_buy_amount` as a **reminder**, not a live feed subscription.

| Scenario | Saved `target_max_buy_amount` | Notes |
|----------|-------------------------------|-------|
| User entered reference + computed Max Buy | Computed guidance (`$125.28`) | Stored as user's target |
| User overrode computed Max Buy | User's typed value (`$120.00`) | **Assumption:** allow override |
| User skipped reference | `null` | Watchlist saved; no Max Buy reminder |

**Confirmed:** No watchlist alerts on price changes until a pricing provider exists and `pricing_provider_enabled` is ON (`MVP_SCOPE.md` open question).

Watchlist without a provider is a **manual shopping list**, not a price-drop alert.

---

## 7. Max Buy formula (reminder)

From `MAX_BUY_CALCULATOR.md` §3:

```
max_buy_amount = round_half_up_to_cent(
  reference_price
  × (1 - target_margin_pct)
  × (1 - fees_buffer_pct)
  × condition_factor
)
```

**All inputs except `reference_price`** come from user preferences (defaults: `0.20`, `0.13`, `1.0`).

`reference_price` is user-typed or from a previous snapshot.

No vendor API call.

---

## 8. Storage without a pricing provider

### 8.1 `crm_price_snapshots`

| Field | Value when user-entered | Value when no reference |
|-------|-------------------------|-------------------------|
| `source` | `user_entered` | (no snapshot row created) |
| `amount` | User's typed value | — |
| `provider_name` | `null` | — |
| `is_estimate` | `true` | — |

### 8.2 `crm_purchases`

| Field | Value when Max Buy computed | Value when reference null |
|-------|-----------------------------|-----------------------------|
| `max_buy_amount` | Computed guidance | `null` |
| `reference_price_amount` | User's reference | `null` |
| `reference_price_source` | `user_entered` | `none` |

All-in cost fields (`purchase_price`, shipping, tax, fees, supplies, `all_in_total`) are **independent** of Max Buy. They record actual spend, not guidance.

---

## 9. What changes when a pricing provider is later added

**Unconfirmed** (Validation item).

When a provider is chosen:

| Change | Impact |
|--------|--------|
| `pricing_provider_enabled` flag ON | UI shows "Latest estimate: $8.25 (from Provider)" |
| `crm_price_snapshots.source` | `later_provider` (new rows) |
| User choice | Accept estimate **or** override with own reference |
| Max Buy formula | **Unchanged** — same math, different reference source |
| CRM storage | Same fields; `provider_name` populated |

**Still forbidden:**
- TCGdex `pricing`  
- CardSight as price source  
- Scraped marketplaces  

---

## 10. Private beta testing without a provider

**Assumption:** Beta cohort must validate:

1. Scan → Confirm → **user-entered reference** → Max Buy → Purchased → inventory save  
2. Purchased save with **no reference** → Max Buy null → all-in cost recorded  
3. Watchlist with **target Max Buy** as a manual reminder  
4. User understands Max Buy is **their math**, not a CardFlow/vendor price  

Success criteria (`MVP_SUCCESS_METRICS.md` assumptions):
- Users can complete the loop without a live pricing feed  
- Users do not expect CardFlow to "look up the price" (education/onboarding)  
- Purchased save rate ≥ 80% of Purchased taps (Max Buy null does not block)  

If testers demand live pricing and refuse to type references, that is **evidence for prioritizing a provider**, not a blocker for CRM validation.

---

## 11. Fixtures

Mock examples in `packages/shared/fixtures/`:

| File | Scenario |
|------|----------|
| `max-buy-with-reference-price-example.json` | User-entered reference; Max Buy computed |
| `max-buy-without-reference-price-example.json` | Reference null; Max Buy null; CRM still saves |
| `max-buy-watchlist-example.json` | Watchlist target reminder |

See also `crm-inventory-item-purchased-example.json` (Pikachu with user-entered reference), `crm-inventory-item-watchlist-example.json` (Charizard).

---

## 12. Founder decisions

1. Accept **user-entered reference only** for private beta (recommended) or block beta until a provider is chosen.  
2. Whether to allow **reference override** when a provider is later added (recommended: yes).  
3. Whether watchlist **alerts** on price changes are in private beta (recommended: **no**, requires provider).  
4. Onboarding copy to educate testers that Max Buy is user math, not a live feed (recommended: yes, short tooltip).  

---

## 13. Non-decisions (out of this spike)

- Which pricing provider and what fields/terms are available — **Validation item**  
- Exact "enter reference" UX and input validation — later design  
- Whether to cache a "last typed reference" per user globally vs per card — UX/preferences decision  
- Whether to show historical snapshots in a price-history view — later feature  

---

**Version:** 2026-09-12  
**Spike deliverable for review** — Provider-less Max Buy path; no vendor integration, no invented API fields, no live keys.
