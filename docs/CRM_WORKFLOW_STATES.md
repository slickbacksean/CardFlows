# CardFlow CRM Workflow States

**Status:** Spike recommendation (no migrations)  
**Version:** 2026-09-12  
**Related:** `CRM_DATA_MODEL.md` section 3.8 (InventoryItem), `MVP_SCOPE.md` primary journey

---

## 1. Overview

CardFlow tracks inventory items through a **lifecycle** from acquisition → listing → sale → payout.

**MVP scope:** Focus on **early states** (acquired → drafted). Later states (listed → sold → shipped → paid out) are **deferred** until marketplace integration or manual tracking is validated.

---

## 2. Proposed Workflow States

### Full Lifecycle (Planning)

```
acquired → photographed → priced → drafted → listed → sold → shipped → paid_out
```

### MVP Cut (Recommended)

```
acquired → drafted
```

**Deferred (post-MVP):**

- `photographed` — user captures listing photos (separate from scan photo).
- `priced` — user finalizes asking price (currently part of draft creation).
- `listed` — published to marketplace (auto-publish is a non-goal).
- `sold` — buyer committed (requires marketplace integration).
- `shipped` — tracking number captured (requires order management).
- `paid_out` — seller received payout (requires marketplace integration).

---

## 3. MVP States

### 3.1 `acquired` (Status: `purchased`)

**Definition:** User confirmed purchase and saved to inventory.

**Triggers:**

- User scans card → confirms identity → taps **Purchased** → enters all-in cost.
- `InventoryItem.status = purchased`
- `Purchase` record created (1:1 for MVP).

**Data captured:**

- `cardflow_card_id`, `language`, `selected_variant`, `quantity`, `condition`
- `purchase_price_cents`, `all_in_cost_cents`, `purchase_date`, `vendor_name`

**Next actions:**

- User can create a listing draft (move to `drafted`).
- User can update condition, storage location, notes.

**UX display:** "Inventory" tab → "Acquired" filter (default).

---

### 3.2 `drafted` (ListingDraft.status: `draft` or `ready`)

**Definition:** User created a reviewed listing draft (not published).

**Triggers:**

- User selects inventory item → taps **Create Draft** → enters title, description, asking price, photos.
- `ListingDraft` record created.
- `ListingDraft.status = draft` (in progress) or `ready` (reviewed, ready for manual publish).

**Data captured:**

- `title`, `description`, `asking_price_cents`, `condition`, `photos_json`
- `InventoryItem` remains `status: purchased` (inventory state unchanged).

**Next actions:**

- User reviews draft → marks `ready` → manually copies to eBay/Whatnot/etc. (outside CardFlow).
- User discards draft → `ListingDraft.status = archived`.

**UX display:** "Drafts" tab → "In Progress" / "Ready" filters.

---

### 3.3 `watchlist` (Status: `watchlist`)

**Definition:** User watching a card, not yet purchased.

**Triggers:**

- User scans card → confirms identity → taps **Watchlist** (no purchase entry).
- `InventoryItem.status = watchlist`
- `Purchase` FK = null.

**Data captured:**

- `cardflow_card_id`, `language`, `selected_variant`, `quantity = 1`
- `PriceSnapshot` records (if pricing provider available).

**Next actions:**

- User later purchases → convert to `acquired` (create Purchase record).
- User removes from watchlist → soft delete or `status = archived`.

**UX display:** "Watchlist" tab.

**Note:** Watchlist is **not** a workflow state (separate status enum value).

---

## 4. Deferred States (Post-MVP)

### 4.1 `photographed`

**Definition:** User captured listing-quality photos (distinct from scan photo).

**Deferred rationale:**

- Scan photo already captured during recognition.
- Listing draft photo capture = part of draft creation (MVP).
- Separate state not needed until multi-step listing prep workflow validated.

**Future triggers:**

- User selects inventory item → taps **Add Listing Photos** → captures/uploads photos.
- `InventoryItem.workflow_state = photographed` (new field).

---

### 4.2 `priced`

**Definition:** User finalized asking price (distinct from Max Buy estimate).

**Deferred rationale:**

- Asking price = part of listing draft creation (MVP).
- Separate state not needed until pricing workflow validated.

**Future triggers:**

- User enters asking price → `workflow_state = priced`.

---

### 4.3 `listed`

**Definition:** Draft published to marketplace (eBay/Whatnot/TCGplayer/Shopify).

**Deferred rationale:**

- **Auto-publish is a non-goal for MVP.**
- Manual copy/paste = outside CardFlow.
- Requires marketplace integration, listing id tracking, and publication audit.

**Future triggers:**

- CardFlow publishes draft to marketplace API → `workflow_state = listed`.
- Manual toggle: user marks "I published this manually" → `workflow_state = listed`.

**Future data:**

- `marketplace_listing_id`, `marketplace_name`, `listing_url`, `listed_at`.

---

### 4.4 `sold`

**Definition:** Buyer committed to purchase (order placed).

**Deferred rationale:**

- Requires marketplace integration or manual order tracking.
- MVP focus = acquisition + draft, not sale tracking.

**Future triggers:**

- Marketplace webhook → order created → `workflow_state = sold`.
- Manual toggle: "I sold this card" → `workflow_state = sold`.

**Future data:**

- `sold_price_cents`, `sold_at`, `buyer_name`, `order_id`.

---

### 4.5 `shipped`

**Definition:** Seller shipped the card (tracking number captured).

**Deferred rationale:**

- Requires order management workflow.
- MVP focus = acquisition + draft, not fulfillment.

**Future triggers:**

- User enters tracking number → `workflow_state = shipped`.

**Future data:**

- `tracking_number`, `carrier`, `shipped_at`.

---

### 4.6 `paid_out`

**Definition:** Seller received payout from marketplace.

**Deferred rationale:**

- Requires marketplace integration (payout webhooks).
- MVP focus = acquisition + draft, not financial reconciliation.

**Future triggers:**

- Marketplace payout webhook → `workflow_state = paid_out`.
- Manual toggle: "I received payment" → `workflow_state = paid_out`.

**Future data:**

- `payout_amount_cents`, `payout_date`, `payout_method`.

---

## 5. MVP Schema Impact

### InventoryItem Table (MVP)

| Field | Type | Notes |
|-------|------|-------|
| `status` | enum | `purchased` \| `watchlist` (MVP only) |

**No `workflow_state` field in MVP.** Workflow inferred from:

- `status: purchased` + no draft = **acquired**.
- `status: purchased` + draft exists = **drafted** (listing-prep phase).
- `status: watchlist` = **watching** (not purchased).

---

### ListingDraft Table (MVP)

| Field | Type | Notes |
|-------|------|-------|
| `status` | enum | `draft` \| `ready` \| `archived` |

**Draft state tracks listing-prep workflow:**

- `draft` = in progress.
- `ready` = reviewed, ready for manual publish.
- `archived` = discarded.

---

### Future: Add `workflow_state` Field

**Post-MVP schema evolution:**

```sql
ALTER TABLE inventory_items ADD COLUMN workflow_state VARCHAR(50);
-- Values: acquired | photographed | priced | drafted | listed | sold | shipped | paid_out
```

**Triggers:**

- `workflow_state` advances automatically or via user action.
- `status` remains `purchased` (inventory ownership unchanged until sold).

---

## 6. State Transitions (MVP)

```
[Scan] → [Confirm] → [Purchased] → acquired
                   ↓
               [Watchlist] → watchlist
                   ↓
               [Convert to Purchased] → acquired

acquired → [Create Draft] → drafted (draft)
        → [Finalize Draft] → drafted (ready)
        → [Discard Draft] → drafted (archived)

watchlist → [Remove] → (soft delete or archived status)
```

**Notes:**

- No automatic state transitions (all user-initiated).
- Drafts do **not** change `InventoryItem.status` (remain `purchased`).

---

## 7. UX Impact

### 7.1 Inventory Tabs (MVP)

| Tab | Filter | Display |
|-----|--------|---------|
| **Acquired** | `status: purchased` + no draft | Cards ready for listing prep |
| **Drafts** | `status: purchased` + draft exists | Cards with in-progress or ready drafts |
| **Watchlist** | `status: watchlist` | Cards being watched |

**Assumption:** Tab names and filters = product decision (TBD).

---

### 7.2 Listing Draft Flow (MVP)

1. User views **Acquired** tab → selects card.
2. User taps **Create Draft**.
3. User enters title, description, asking price, photos.
4. User saves → `ListingDraft.status = draft`.
5. User reviews → marks **Ready**.
6. User manually copies to eBay/Whatnot (outside CardFlow).

**No auto-publish, no marketplace API, no listing id tracking in MVP.**

---

### 7.3 Future: Listed → Sold Flow

1. User publishes draft (manual or API) → `workflow_state = listed`.
2. Buyer purchases → `workflow_state = sold`.
3. User ships → `workflow_state = shipped`.
4. Marketplace pays out → `workflow_state = paid_out`.
5. Card removed from inventory (or status = `sold` archive).

**Deferred until marketplace integration validated.**

---

## 8. Workflow State vs Status

| Concept | Field | Purpose | MVP |
|---------|-------|---------|-----|
| **Status** | `InventoryItem.status` | Ownership state (`purchased` \| `watchlist`) | ✅ Yes |
| **Workflow State** | `InventoryItem.workflow_state` (future) | Lifecycle state (acquired → paid out) | ❌ Post-MVP |
| **Draft State** | `ListingDraft.status` | Draft progress (`draft` \| `ready` \| `archived`) | ✅ Yes |

**Rationale:**

- MVP: `status` + draft existence = sufficient for acquired/drafted distinction.
- Future: `workflow_state` adds granular lifecycle tracking (photographed, priced, listed, sold, shipped, paid out).

---

## 9. MVP Cut Rationale

### Why Defer `listed` → `paid_out`?

**Non-goals for MVP** (see `NON_GOALS.md`):

- Automatic eBay listing publication.
- Marketplace account automation.
- Scraping, auto-bid, auto-buy.
- Order management, fulfillment tracking.

**Conclusion:** MVP validates **acquisition + Max Buy + CRM + draft**. Sale tracking = later validation after core loop proven.

---

### Why Keep `acquired` and `drafted`?

**Required for MVP primary journey** (see `MVP_SCOPE.md`):

- User scans → confirms → **saves to inventory** (`acquired`).
- User later creates **reviewed listing draft** (`drafted`).

**Conclusion:** Minimum states for private beta CRM validation.

---

## 10. Summary

| State | MVP | Data Captured | Next Action |
|-------|-----|---------------|-------------|
| **acquired** | ✅ Yes | Purchase + all-in cost | Create draft |
| **drafted** | ✅ Yes | Draft title, description, asking price, photos | Manual publish (outside CardFlow) |
| **watchlist** | ✅ Yes (separate status) | Price snapshots, no purchase | Convert to purchased or remove |
| `photographed` | ❌ Deferred | Listing photos | — |
| `priced` | ❌ Deferred | Asking price finalized | — |
| `listed` | ❌ Deferred | Marketplace listing id | — |
| `sold` | ❌ Deferred | Order, buyer, sold price | — |
| `shipped` | ❌ Deferred | Tracking number | — |
| `paid_out` | ❌ Deferred | Payout amount, date | — |

**Recommended MVP cut:** `acquired` + `drafted` only.

---

## 11. Unknowns / Founder Decisions Needed

1. **Tab names** for Acquired / Drafts / Watchlist (UX copy TBD).
2. **Manual "I published this" toggle** vs API-only `listed` state (product decision).
3. **Watchlist → Purchased conversion** UX (one-tap vs full purchase entry).
4. **Draft discard** behavior (soft delete vs `archived` status).
5. **Multi-step listing prep** validation (does photographed/priced state add value vs single draft flow?).

---

**Version:** 2026-09-12  
**Next:** See `CRM_LISTING_DRAFT_FIELDS.md` for full draft field spec.
