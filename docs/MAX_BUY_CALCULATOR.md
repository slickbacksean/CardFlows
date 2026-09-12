# CardFlow Max Buy Calculator

**Status:** Spike recommendation for review. **No production calculator code. No live pricing provider.**  
**Related:** `ALL_IN_COST_MODEL.md`, `MAX_BUY_WITHOUT_PRICING_PROVIDER.md`, `CRM_DATA_MODEL.md` §8, §11, `MVP_SCOPE.md`, `NON_GOALS.md`.

---

## Legend

| Label | Meaning |
|-------|---------|
| **Confirmed** | Already decided in CardFlow product / mapping docs on `main`. |
| **Unconfirmed** | Depends on a later provider, legal review, or missing product spec. Do not invent. |
| **Assumption** | Spike recommendation pending founder decision. |
| **Founder decision** | Requires explicit product approval. |

---

## 1. What Max Buy is

**Confirmed:** Max Buy is **CardFlow-owned user math** that helps a flipper answer "how much should I offer for this card?"

It is:
- A **guidance calculation** from user-configured rules  
- Applied at **decide-to-buy** time (before Purchased tap)  
- Stored as a **snapshot** with the purchase  

It is **not**:
- A guaranteed market price  
- A vendor-dictated bid  
- A profit promise  
- A buy-it-now auto-fill  

**Confirmed:** Max Buy works **without** a live pricing provider (`MVP_SCOPE.md` Validation item; `NON_GOALS.md` — no Whatnot/eBay scraping, no invented API).

---

## 2. Inputs

### 2.1 User-typed at decide-to-buy time

| Input | When | Required for Max Buy? | Notes |
|-------|------|-----------------------|-------|
| `reference_price` | User types a comparable OR uses last snapshot | **No** | See §4 (missing reference) |
| `condition` | Confirm or Purchased screen | No | Used if condition adjustments exist |

### 2.2 Stored on user preferences

**Assumption:** Defaults pending founder confirmation.

| Preference field | Default | Unit | Notes |
|-----------------|---------|------|-------|
| `max_buy_target_margin_pct` | `0.20` | Decimal (20%) | **Assumption** |
| `max_buy_fees_buffer_pct` | `0.13` | Decimal (13%) | **Assumption** |
| `max_buy_condition_adjustments_json` | `null` or `{"NM": 1.0}` | Map | **Founder decision** — optional |
| `default_currency` | `USD` | ISO 4217 | **Assumption** for NA beta |

User may edit these in a Max Buy / Preferences screen.

### 2.3 Pricing provider (later / TBD)

**Unconfirmed:** A chosen pricing provider may supply a reference estimate. That is a **Validation item** (`MVP_SCOPE.md`). Do not invent fields.

When no provider: user types the reference, or Max Buy shows "enter a reference price" (§4).

---

## 3. Formula

**Assumption** (matches `crm-inventory-item-purchased-example.json` Pikachu math):

```
max_buy_amount = round_half_up_to_cent(
  reference_price
  × (1 - target_margin_pct)
  × (1 - fees_buffer_pct)
  × condition_factor
)
```

### 3.1 Worked example 1: Pikachu Base Set #58, NM

From `crm-inventory-item-purchased-example.json`:

| Input | Value | Source |
|-------|-------|--------|
| `reference_price` | `$8.00` | User-entered comparable |
| `target_margin_pct` | `0.20` | User preferences (default) |
| `fees_buffer_pct` | `0.13` | User preferences (default) |
| `condition_factor` | `1.0` | NM / default |

Calculation:

```
8.00 × (1 - 0.20) × (1 - 0.13) × 1.0
= 8.00 × 0.80 × 0.87 × 1.0
= 5.568
→ $5.57 (round half up to cent)
```

**Result:** Max Buy guidance is **$5.57**.

User sees: "Based on your $8.00 reference, Max Buy: $5.57"

### 3.2 Worked example 2: Charizard Base Set #4, holo watchlist

From `crm-inventory-item-watchlist-example.json`:

| Input | Value | Source |
|-------|-------|--------|
| `reference_price` | `$180.00` | User-entered |
| `target_margin_pct` | `0.20` | Default |
| `fees_buffer_pct` | `0.13` | Default |
| `condition_factor` | `1.0` | Holo, NM assumed |

Calculation:

```
180.00 × 0.80 × 0.87 × 1.0
= 125.28
→ $125.28
```

Watchlist stores `target_max_buy_amount: "120.00"` as the user's **reminder**. That may differ from the computed guidance if the user overrode it or if preferences changed since save. Watchlist is not cost basis.

---

## 4. When reference price is missing

**Confirmed:** Purchased / Watchlist save is **not blocked** by missing reference price (`CRM_DATA_MODEL.md` §11).

CRM behavior:

| Scenario | Max Buy result | UI copy | Save allowed? |
|----------|----------------|---------|---------------|
| Reference price exists | Computed `max_buy_amount` | "Max Buy: $5.57" | Yes |
| Reference price is `null` | `max_buy_amount = null` | "Enter a reference price to compute Max Buy." | **Yes** |

**Never** backfill reference from:
- TCGdex `pricing`  
- CardSight as a price source  
- Scraped eBay / Whatnot / TCGplayer  

User must type it, or choose a previous snapshot, or leave it null.

---

## 5. Field storage

### 5.1 On `crm_purchases` (snapshot at save)

From `CRM_DATA_MODEL.md` §14.6:

| Field | Type | Purpose |
|-------|------|---------|
| `max_buy_amount` | Nullable decimal (minor units) | Computed guidance used at Purchased tap |
| `reference_price_amount` | Nullable decimal | What Max Buy formula used |
| `reference_price_source` | `user_entered` \| `later_provider` \| `none` | Provenance |
| `target_margin_pct` (optional) | Decimal | Snapshot of preference at save |
| `fees_buffer_pct` (optional) | Decimal | Snapshot of preference at save |
| `condition_factor` (optional) | Decimal | Condition adjustment if applied |

**Assumption:** Snapshot the rule inputs so later preference edits do not rewrite history.

### 5.2 On `crm_inventory_items` (watchlist only)

| Field | Type | Purpose |
|-------|------|---------|
| `target_max_buy_amount` | Nullable decimal | Watchlist **reminder**, not cost basis |

Watchlist has no purchase row, no `all_in_total`.

### 5.3 On `crm_user_preferences`

From `CRM_DATA_MODEL.md` §14.10:

| Field | Default | Purpose |
|-------|---------|---------|
| `max_buy_target_margin_pct` | `0.20` | **Assumption** |
| `max_buy_fees_buffer_pct` | `0.13` | **Assumption** |
| `max_buy_condition_adjustments_json` | `null` | **Founder decision** — optional map |
| `default_currency` | `USD` | **Assumption** |

---

## 6. Condition adjustment

**Assumption:** Default `condition_factor = 1.0` (NM / unspecified).

**Founder decision:** Whether to provide a preferences map for LP / MP / HP / DMG. Do not invent a full PSA/BGS grade table as Confirmed.

Example optional map (not Confirmed):

```json
{
  "NM": 1.0,
  "LP": 0.85,
  "MP": 0.65,
  "HP": 0.40,
  "DMG": 0.20
}
```

If the user enters condition and the map exists, use it. Otherwise default `1.0`.

---

## 7. Currency and rounding

**Confirmed:**
- Currency: ISO 4217 (`CRM_DATA_MODEL.md` §8)  
- Default: **`USD`** (Assumption for NA beta)  
- Persist: **integer minor units** (cents)  
- Display: **dollars** (decimal strings in fixtures for readability)  

**Assumption:** Rounding is **round half up to cent** (banker's rounding is an alternative; this spike recommends half-up for simplicity).

Compute in integer minor units to avoid float precision errors:

```typescript
// Pseudocode
const referenceCents = referencePriceAmount * 100;
const factorProduct = (1 - targetMarginPct) * (1 - feesBufferPct) * conditionFactor;
const maxBuyCents = Math.round(referenceCents * factorProduct);
const maxBuyAmount = (maxBuyCents / 100).toFixed(2);
```

---

## 8. What happens before and after Max Buy

| Moment | Data | Where |
|--------|------|-------|
| **Confirm card identity** | Catalog + optional price snapshot | `crm_confirmations` + `crm_price_snapshots` |
| **Before Purchased tap** | User sees Max Buy guidance | Screen only (no save yet) |
| **Purchased tap** | Max Buy + all-in cost snapshot saved | `crm_purchases` + `crm_inventory_items` |
| **Later listing draft** | Compare `asking_price` to `all_in_total` as spread | `crm_listing_drafts` (internal document) |

Max Buy is **buy-side guidance**. All-in cost is **actual spend** (see `ALL_IN_COST_MODEL.md`). Draft asking price is **sell-side estimate**.

Never label the spread as "guaranteed profit."

---

## 9. Max Buy vs all-in cost

| | **Max Buy** | **All-in cost** |
|---|-------------|-----------------|
| When | Before/during Purchased tap | After Purchased tap |
| Purpose | Decide-to-buy guidance | Cost basis / inventory record |
| Inputs | Reference + rules | User-entered spend lines |
| Stored on | `crm_purchases.max_buy_amount` (snapshot) | `crm_purchases` (5 cost fields + total) |
| Required to save? | **No** | `currency`, `purchase_price`, `purchased_at` required; others optional with default `0` |
| Exact? | **No** — guidance only | **No** — user-entered estimate, not receipts |

User may buy for less than Max Buy (great deal) or more (judgment call). All-in records what they actually paid plus allocated fees/shipping/supplies.

---

## 10. Copy / claims rules

**Confirmed:**

- **Never** promise profit  
- **Never** call Max Buy a market price, fair value, or guaranteed buy price  
- **Always** label price snapshots as estimates (`isEstimate: true`)  
- **Always** label Max Buy as "guidance from your rules"  
- All-in cost is user-entered cost basis, not a vendor fee schedule  

Example safe copy:

> Based on your $8.00 reference and your 20% margin + 13% fees buffer, **Max Buy guidance: $5.57**. This is not a market price or a guaranteed profit.

---

## 11. What must never be used

| Forbidden | Why |
|-----------|-----|
| TCGdex `pricing` / `variants_detailed` pricing | Not CardFlow market truth; catalog metadata only |
| CardSight as a price source | Recognition-only provider |
| Scraped eBay / Whatnot / TCGplayer prices | Non-goal; legal/technical risk |
| Invented pricing vendor API | Validation item; do not invent fields or permissions |
| Auto-filled marketplace bids or buy-it-now | Marketplace automation forbidden |

---

## 12. Fixtures

Mock examples in `packages/shared/fixtures/`:

| File | Scenario |
|------|----------|
| `max-buy-with-reference-price-example.json` | User-entered reference; computed Max Buy |
| `max-buy-without-reference-price-example.json` | Reference `null`; Max Buy `null`; CRM still saves |
| `max-buy-watchlist-example.json` | Watchlist target reminder |

See also `crm-inventory-item-purchased-example.json` (Pikachu with Max Buy), `crm-inventory-item-watchlist-example.json` (Charizard).

---

## 13. Founder decisions

1. Accept default **`target_margin_pct = 0.20`** and **`fees_buffer_pct = 0.13`** (recommended) or revise.  
2. Accept **round half up to cent** (recommended) or choose banker's rounding.  
3. Whether condition adjustments are an optional map (recommended) or required full vocabulary for beta.  
4. Whether to snapshot rule inputs on the purchase (recommended) or recompute on demand.  
5. Confirm **`USD`** as default currency for NA beta.  

---

## 14. Non-decisions (out of this spike)

- Which pricing provider (if any) and what estimate fields are available — **Validation item**  
- Exact Max Buy / Preferences screen UX — later design  
- Whether to alert on reference price changes for watchlist — depends on pricing provider  
- Whether drafts show a "potential margin" — allowed if never labeled "guaranteed profit"  

---

**Version:** 2026-09-12  
**Spike deliverable for review** — Formula, inputs, storage, and copy rules; no production calculator code, no pricing vendor integration.
