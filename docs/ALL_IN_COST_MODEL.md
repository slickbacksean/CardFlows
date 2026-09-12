# CardFlow All-In Cost Model

**Status:** Spike recommendation for review. **No production tables. No API routes.**  
**Related:** `MAX_BUY_CALCULATOR.md`, `CRM_DATA_MODEL.md` §8, `CRM_INVENTORY_GRAIN.md`, `CRM_LISTING_DRAFT_FIELDS.md`, `MVP_SCOPE.md`.

---

## Legend

| Label | Meaning |
|-------|---------|
| **Confirmed** | Already decided in CardFlow product / mapping docs on `main`. |
| **Assumption** | Spike recommendation pending founder decision. |
| **Founder decision** | Requires explicit product approval. |

---

## 1. What all-in cost is

**Confirmed:** All-in cost is the **total user-entered money spent** to acquire and prepare one purchased card for inventory.

It is:
- **User-entered** (not scraped, not a vendor API fee schedule)  
- **Stored on `crm_purchases`** (one purchase row per purchased inventory item)  
- A **cost basis** for later margin/spread calculations (not a profit guarantee)  
- Recorded **after** the user taps Purchased  

It is **not**:
- Max Buy guidance (Max Buy happens **before/during** the buy decision)  
- A marketplace fee schedule  
- A receipt OCR result (MVP is manual entry)  
- Sell-side asking price (that is on listing drafts)  

**Confirmed:** All-in cost is independent of Max Buy. User may buy below Max Buy (great deal), at Max Buy, or above Max Buy (judgment call). CRM records what actually happened.

---

## 2. All-in formula

**Assumption** (aligned with `CRM_DATA_MODEL.md` §8):

```
all_in_total = purchase_price + shipping + tax + fees + supplies
```

### 2.1 Field definitions

From `CRM_DATA_MODEL.md` §8 and `crm-inventory-item-purchased-example.json`:

| Field | Required to save Purchased? | Default if omitted | Notes |
|-------|-----------------------------|--------------------|-------|
| `currency` | **Yes** | (user preferences) | ISO 4217. **Assumption:** `USD` for NA beta |
| `purchase_price` | **Yes** | — | What the user paid for the card / lot line |
| `shipping` | No | `0` | Inbound shipping allocated to this copy |
| `tax` | No | `0` | Sales tax / VAT allocated to this copy |
| `fees` | No | `0` | Buy-side platform or payment fees (**not** eBay/TCGplayer seller fees) |
| `supplies` | No | `0` | Sleeves, toploaders, penny sleeves allocated to this copy |
| `all_in_total` | Derived | — | Persist the computed sum at save time |
| `purchased_at` | **Yes** | — | User-entered or device timestamp |

**Assumption:** Only `currency`, `purchase_price`, and `purchased_at` are **required** to save Purchased. Others default to `0` if the user skips them.

**Founder decision:** Whether to make `shipping` or `supplies` required for private beta testers (flippers). This spike recommends optional to reduce friction, but the founder may require at least one all-in breakdown.

---

## 3. Worked examples

### 3.1 Complete all-in: Pikachu Base Set #58

From `crm-inventory-item-purchased-example.json`:

| Line | Amount | Notes |
|------|--------|-------|
| Purchase price | `$3.50` | Card price at shop |
| Shipping | `$0.00` | Bought in person |
| Tax | `$0.29` | Sales tax |
| Fees | `$0.00` | Cash, no platform |
| Supplies | `$0.25` | Toploader |
| **All-in total** | **`$4.04`** | Sum |

User later creates a listing draft with `asking_price: $9.00`. Potential spread: `$9.00 - $4.04 = $4.96`. Never label as "guaranteed profit" — it is an internal estimate comparison.

### 3.2 Purchase price only: minimal entry

Fixture: `all-in-cost-purchase-price-only-example.json`

| Line | Amount | Notes |
|------|--------|-------|
| Purchase price | `$15.00` | Only required field filled |
| Shipping | `$0.00` | Default |
| Tax | `$0.00` | Default |
| Fees | `$0.00` | Default |
| Supplies | `$0.00` | Default |
| **All-in total** | **`$15.00`** | Sum |

User tapped Purchased, entered purchase price only, and saved. CRM does not block this. Later the user may realize their actual all-in was higher; they can edit (if edit is later enabled) or note in listing draft `notes`.

---

## 4. Currency and units

**Confirmed:**
- Currency: ISO 4217 (`CRM_DATA_MODEL.md` §8)  
- Default: **`USD`** (Assumption for NA beta)  
- Persist: **integer minor units** (cents)  
- Display: **dollars** (decimal strings in fixtures for readability)  

All five money fields use the same `currency`. Mixed-currency receipts are out of MVP scope.

---

## 5. Multi-card receipts (out of MVP)

**Assumption:** User buys a 3-card lot from one seller. They create **three purchased items** (one row per physical copy, `CRM_INVENTORY_GRAIN.md`) and **allocate cost manually**:

| Copy | Allocated purchase_price | Allocated shipping | Allocated supplies |
|------|--------------------------|--------------------|--------------------|
| Card A | `$3.00` | `$1.00` | `$0.25` |
| Card B | `$5.00` | `$1.00` | `$0.25` |
| Card C | `$2.00` | `$1.00` | `$0.25` |

Or user enters full receipt total on the first save, then duplicates $0 shipping for the other two. That is a UX decision, not a data model decision.

**Founder decision:** Whether to add a "save ×N" helper that duplicates a purchase with cost allocation. Not required for MVP.

**Out of scope:** Receipt OCR, automatic cost splitting, `lot` as a single saleable unit (`CRM_INVENTORY_GRAIN.md` later).

---

## 6. When all-in cost is recorded

| Moment | Data written | Where |
|--------|--------------|-------|
| Scan | No cost | `crm_scans` |
| Confirm identity | No cost | `crm_confirmations` |
| Watchlist | **No cost** | `crm_inventory_items` (`intent=watchlist`); no purchase row |
| **Purchased tap** | All-in cost saved | `crm_purchases` + `crm_inventory_items` (`intent=purchased`) |
| Later listing draft | Compare `asking_price` to `all_in_total` | `crm_listing_drafts` (internal) |

Watchlist is interest, not a copy; no purchase row, no cost basis.

---

## 7. All-in cost vs Max Buy

| | **Max Buy** | **All-in cost** |
|---|-------------|-----------------|
| When | Before/during buy decision | After Purchased tap |
| Purpose | Guidance: "how much should I offer?" | Cost basis: "what did I spend?" |
| Inputs | Reference price + rules | User-entered actual spend |
| Formula | `reference × (1 - margin) × (1 - fees_buffer) × condition` | `purchase + shipping + tax + fees + supplies` |
| Required? | **No** (reference can be null) | `currency`, `purchase_price`, `purchased_at` required; others optional default `0` |
| Exact? | **No** — guidance | **No** — user estimate, not receipts |

User may buy below Max Buy, at Max Buy, or above. CRM does not enforce Max Buy as a gate.

---

## 8. All-in cost vs listing draft asking price

From `crm-listing-draft-example.json` (Pikachu):

| Field | Value | Where |
|-------|-------|-------|
| `all_in_total` | `$4.04` | `crm_purchases` |
| `asking_price` | `$9.00` | `crm_listing_drafts` |
| Potential spread | `$4.96` | `asking_price - all_in_total` (internal calculation only) |

**Confirmed:** Listing drafts are **internal CardFlow documents**, not marketplace listings (`CRM_LISTING_DRAFT_FIELDS.md`; `NON_GOALS.md`).

Copy rules:
- **Never** label spread as "guaranteed profit"  
- Optional: show "potential margin" or "spread" in the draft screen if clearly marked as estimate  
- Asking price is a **user estimate** of what they might list for, not a live market  

---

## 9. Field storage

### 9.1 On `crm_purchases`

From `CRM_DATA_MODEL.md` §14.6:

| Column | Type | Purpose |
|--------|------|---------|
| `purchase_id` | UUID | PK |
| `inventory_item_id` | UUID | FK to purchased item |
| `purchased_at` | Timestamp | **Required** |
| `currency` | ISO 4217 | **Required** |
| `purchase_price` | Integer minor units | **Required** |
| `shipping` | Integer minor units | Default `0` |
| `tax` | Integer minor units | Default `0` |
| `fees` | Integer minor units | Default `0` |
| `supplies` | Integer minor units | Default `0` |
| `all_in_total` | Integer minor units | Derived, persisted |
| `source_note` | Text | Optional free text ("local shop") |
| `notes` | Text | Optional |

**Assumption:** Persist `all_in_total` at save rather than recompute on read. That locks the sum even if field semantics change later.

---

## 10. What all-in cost must not include

| Forbidden | Why |
|-----------|-----|
| Marketplace seller fees (eBay final value, TCGplayer commission) | Sell-side cost, not buy-side. Out of MVP. |
| Listing/shipping costs **to the buyer** | Not incurred yet; drafts are internal. |
| Scraped receipt data | No receipt OCR; manual entry only. |
| TCGdex `pricing` | Not cost basis; catalog metadata only. |
| Max Buy `fees_buffer_pct` backfilled into `fees` | Max Buy buffer ≠ actual platform fee; user enters actual. |
| Grading fees | MVP is raw singles; graded slabs are later. |

---

## 11. Copy / claims rules

**Confirmed:**

- All-in cost is **user-entered cost basis**, not a vendor fee schedule  
- Spread (asking price − all-in) is an **internal estimate**, never "guaranteed profit"  
- Asking price is a **user estimate**, not a market price  

Example safe copy:

> Your all-in cost for this card: **$4.04**. Your draft asking price: **$9.00**. Potential margin: **$4.96** (estimate only).

---

## 12. Fixtures

Mock examples in `packages/shared/fixtures/`:

| File | Scenario |
|------|----------|
| `all-in-cost-complete-example.json` | All five cost lines filled (Pikachu) |
| `all-in-cost-purchase-price-only-example.json` | Minimal entry: purchase price + defaults |
| `crm-inventory-item-purchased-example.json` | Complete purchased item with all-in + Max Buy |

---

## 13. Founder decisions

1. Accept **five cost lines** (purchase, shipping, tax, fees, supplies) as the recommended breakdown (already aligned with `CRM_DATA_MODEL.md` §8).  
2. Accept **purchase_price only required** (recommended) vs require at least one optional line for testers.  
3. Whether to persist `all_in_total` (recommended) or recompute.  
4. Whether sold/shipped later writes **outbound costs** (packaging, postage, eBay fees) — those are out of this spike; likely on a later `crm_sales` or `crm_shipments`.  

---

## 14. Non-decisions (out of this spike)

- Exact Purchased screen UX for entering cost lines — later design  
- Receipt OCR — out of MVP  
- Multi-card lot cost allocation helper — later  
- Grading fee fields — later, if slabs are added  
- Whether drafts show potential margin — allowed if safe copy; UX decision  

---

**Version:** 2026-09-12  
**Spike deliverable for review** — All-in cost formula, field definitions, and storage; no production tables, no API routes.
