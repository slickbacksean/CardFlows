# CardFlow Workflow States

**Status:** Spike recommendation for review. **No production state machine code.**  
**Related:** `CRM_DATA_MODEL.md`, `CRM_LISTING_DRAFT_FIELDS.md`, `MVP_SCOPE.md`, `NON_GOALS.md`.

---

## 1. Product loop vs warehouse loop

MVP journey (`PRODUCT_OVERVIEW.md`):

**Scan → Confirm → (estimate / Max Buy) → Purchased or Watchlist → listing draft**

The issue’s warehouse-style list is:

`acquired → photographed → priced → drafted → listed → sold → shipped → paid out`

CardFlow MVP **does not publish** to eBay / Whatnot / TCGplayer / Shopify. Several of those states imply a marketplace or payout system that is a **non-goal**. This document splits **MVP** vs **later** and keeps photographed / priced as **flags**, not required sequential gates.

---

## 2. Pre-inventory states (always in MVP)

These are not inventory workflow. They live on scans / confirmations.

| State | Record | Meaning |
|-------|--------|---------|
| `scan_captured` | `crm_scans` | Photo stored; recognition may have succeeded, failed, or returned empty. |
| `identity_unconfirmed` | scan, no confirmation | Candidates or manual search still open. |
| `identity_confirmed` | `crm_confirmations` | User accepted a `cardflow_card_id`. No inventory yet. |
| `identity_rejected` | scan + optional audit | User rejected all candidates; no canonical write. |

CRM writes for Purchased / Watchlist are **blocked** until `identity_confirmed`.

---

## 3. Inventory workflow vocabulary

| State | Intent | MVP? | Meaning |
|-------|--------|------|---------|
| `watching` | watchlist | **MVP** | Saved interest. Not owned. |
| `acquired` | purchased | **MVP** | User tapped Purchased and saved cost (as designed). |
| `photographed` | purchased | **Not a required MVP state** | Listing-quality photos exist *beyond* the scan. Model as a **flag** (`has_listing_photos`) on the item or draft. Scan photo already exists at `acquired`. |
| `priced` | purchased | **Not a required MVP state** | A reference estimate or asking price exists. Model as flags / snapshot / draft `asking_price`. Pricing provider is TBD; do not block drafts on live prices. |
| `drafted` | purchased | **MVP** | At least one `crm_listing_drafts` row exists for this copy. |
| `listed` | purchased | **Later** | Would mean published to a marketplace. Forbidden as a real publish in MVP. |
| `sold` | purchased | **Later** (founder may pull into beta as a **manual** mark) | Copy is no longer for sale. No marketplace sold-price import. |
| `shipped` | purchased | **Later** | Fulfillment. No carrier integration in MVP. |
| `paid_out` | purchased | **Later** | Seller payout. No payment interception. |

Closed / archived:

| State | MVP? | Meaning |
|-------|------|---------|
| `watchlist_closed` | **MVP** | Converted to Purchased or user removed it. |
| `archived` | **MVP** optional | User hid a purchased copy without claiming sold. |

---

## 4. Recommended MVP cut

### 4.1 Watchlist

```
watching  →  watchlist_closed
```

No `acquired`, no `drafted`. Drafts start only after Purchased.

### 4.2 Purchased

```
acquired  →  drafted
```

Optional **attributes** (not extra required states):

| Flag / field | How it gets set in MVP |
|--------------|------------------------|
| Scan photo | Already on `crm_scans` from capture |
| `has_listing_photos` | User attached photos on the draft |
| Price snapshot | User-entered comparable; later provider optional |
| Draft `asking_price` | User-entered on the draft |
| Computed Max Buy | Stored on the purchase row at save |

**Do not** require `photographed` or `priced` before `drafted`. Users can start a draft with catalog identity + user text only.

### 4.3 Explicitly later

| State | Why later |
|-------|-----------|
| `listed` | Automatic (and even assisted) marketplace publication is a non-goal. A text note “I listed this on eBay” is **not** `listed` as a system state. If the founder wants a checkbox, store `intended_channel_note` / `user_marked_externally_listed_at` as a **later** optional field — do not treat it as CardFlow having listed the card. |
| `sold` | No sold-price feed. Manual “mark sold” is a founder add-on, not required to validate the MVP loop. |
| `shipped` | Shipping UX and carriers are out of scope. |
| `paid_out` | Payouts / payment tokens are forbidden in MVP. |

---

## 5. State transition rules (MVP)

| From | To | Trigger | Forbidden if |
|------|----|---------|--------------|
| (none) | `watching` | Watchlist tap after confirm | No `cardflow_card_id` |
| (none) | `acquired` | Purchased tap after confirm | No `cardflow_card_id`; missing required purchase_price / currency |
| `watching` | `watchlist_closed` | Convert to Purchased, or remove | — |
| `acquired` | `drafted` | First listing draft saved | Watchlist intent; missing purchased item |
| `drafted` | `drafted` | Edit draft | Publish APIs (there are none) |
| `acquired` or `drafted` | `archived` | User hides the copy | Using archive as a fake `sold` without founder approval |

**Never** auto-advance on CardSight confidence, TCGdex cache refresh, or a price snapshot arriving.

**Never** transition to `listed` / `sold` / `shipped` / `paid_out` from this spike’s model.

---

## 6. Who may sit in each state

| Record | Allowed `workflow_state` in MVP |
|--------|----------------------------------|
| Watchlist item | `watching`, `watchlist_closed` |
| Purchased item | `acquired`, `drafted`, `archived` |
| Scan / confirmation | Not these values (use pre-inventory states) |

One purchased copy has one workflow state. Two copies of the same `cardflow_card_id` can diverge (`acquired` vs `drafted`). That is why grain is per physical copy.

---

## 7. Photographed and priced as attributes

Issue list included `photographed` and `priced` as workflow steps. For a scanner-first app:

- **Photographed (scan):** true as soon as `crm_scans` exists. Not a listing-prep state.  
- **Photographed (listing):** extra photos on the draft. Many testers will reuse the scan. Making it a gate adds friction without a publish step.  
- **Priced:** live market data is a **Validation item**. User-entered reference + Max Buy already cover the buy decision. Asking price lives on the draft.

If the founder later wants a kanban of eight columns, add states without rewriting ids — `workflow_state` is a CardFlow-owned string on the item.

---

## 8. What workflow must not encode

- Marketplace listed / ended / relisted SKUs  
- Bid, win, or checkout  
- Payment capture or payout  
- “Guaranteed profit” after `sold`  
- TCGdex pricing as the reason a card became `priced`

---

## 9. Founder decisions

1. Accept the **two-state purchased machine** (`acquired` → `drafted`) for private beta.  
2. Whether testers need a **manual `sold`** (no marketplace) in beta. Default: **later**.  
3. Whether “I listed this elsewhere” is a later checkbox or stays a draft note.  
4. Whether `archived` is in the first Home filters.

---

**Version:** 2026-09-12  
**Spike deliverable for review** — State cut only; no app screens or migrations.
