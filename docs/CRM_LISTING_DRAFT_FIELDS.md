# CardFlow CRM Listing Draft Fields

**Status:** Spike recommendation (no migrations)  
**Version:** 2026-09-12  
**Related:** `CRM_DATA_MODEL.md` section 3.11 (ListingDraft), `NON_GOALS.md`

---

## 1. Overview

**ListingDraft** is a CardFlow-internal entity for creating **reviewed, unpublished** listing content.

**Hard rules:**

1. Drafts **stay inside CardFlow** (no auto-publish to eBay/Whatnot/TCGplayer/Shopify).
2. Do **not** invent marketplace-publication fields (listing id, stream id, category mappings, shipping templates).
3. Drafts are **reviewed** by the user before manual publication (outside CardFlow).
4. User photos = listing photos (distinct from scan photo or TCGdex catalog art).

---

## 2. ListingDraft Table

### Core Fields

| Field | Type | Owner | Required | Notes |
|-------|------|-------|----------|-------|
| `listing_draft_id` | UUID | CardFlow | Yes | PK |
| `inventory_item_id` | UUID | CardFlow | Yes | FK to InventoryItem (unique for MVP) |
| `user_id` | UUID | CardFlow | Yes | FK to User |
| `title` | string (max 80 chars) | CardFlow | Yes | Draft listing title |
| `description` | text (max 5000 chars) | CardFlow | Yes | Draft description |
| `asking_price_cents` | int | CardFlow | Yes | User asking price (USD cents) |
| `condition` | enum | CardFlow | Yes | `NM` \| `LP` \| `MP` \| `HP` \| `DMG` \| `RAW` |
| `photos_json` | jsonb | CardFlow | Yes | `["url1", "url2", ...]` user photos (CDN/S3) |
| `status` | enum | CardFlow | Yes | `draft` \| `ready` \| `archived` |
| `created_at` | timestamp | CardFlow | Yes | — |
| `updated_at` | timestamp | CardFlow | Yes | — |

---

### Optional Fields (MVP Recommended)

| Field | Type | Owner | Required | Notes |
|-------|------|-------|----------|-------|
| `quantity_to_list` | int | CardFlow | No | How many copies to list (default = InventoryItem.quantity) |
| `shipping_price_cents` | int (nullable) | CardFlow | No | User shipping charge (if applicable) |
| `notes` | text (nullable) | CardFlow | No | Internal notes (not included in published listing) |

---

### Future Fields (Post-MVP)

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `marketplace_name` | enum | CardFlow | `ebay` \| `whatnot` \| `tcgplayer` \| `shopify` (when publication integrated) |
| `marketplace_listing_id` | string (nullable) | Marketplace | External listing id (after publication) |
| `listing_url` | string (nullable) | Marketplace | Public listing URL |
| `listed_at` | timestamp (nullable) | CardFlow | When published (if tracked) |

**Deferred rationale:** Auto-publish is a non-goal for MVP (see `NON_GOALS.md`).

---

## 3. Field Specs

### 3.1 `title` (string, max 80 chars)

**Purpose:** Short listing title for marketplace copy/paste.

**Constraints:**

- Max 80 chars (eBay title limit guidance).
- User-entered (no auto-generation required for MVP).
- Plain text (no HTML or markdown).

**Example:**

```
Pikachu Base Set #58 English Common Raw NM
```

**Assumption:** Title template or auto-fill from catalog data = product decision (TBD).

---

### 3.2 `description` (text, max 5000 chars)

**Purpose:** Long-form listing description for marketplace copy/paste.

**Constraints:**

- Max 5000 chars (reasonable listing description limit).
- User-entered (may include catalog data copy/paste).
- Plain text or markdown (rendering decision TBD).

**Example:**

```
English Pokémon TCG card in Near Mint condition.
From Base Set, card #58 (Common).
Ships in sleeve + toploader via USPS First Class.
```

**Assumption:** Description template or AI assist = product decision (TBD).

---

### 3.3 `asking_price_cents` (int, required)

**Purpose:** User's asking price for the listing.

**Constraints:**

- USD cents (int, not float).
- Must be > 0.
- User-entered (may use Max Buy or price estimate as guidance).

**Calculation hints (not stored):**

- Cost basis from `Purchase.all_in_cost_cents`.
- Target margin from `UserPreferences.max_buy_rules_json.target_margin_pct`.
- Estimate from `PriceSnapshot.market_price_cents`.

**Example:** `asking_price_cents: 500` = $5.00.

---

### 3.4 `condition` (enum, required)

**Purpose:** User-entered card condition (not automatic grading).

**Enum values:**

- `NM` = Near Mint
- `LP` = Lightly Played
- `MP` = Moderately Played
- `HP` = Heavily Played
- `DMG` = Damaged
- `RAW` = Ungraded raw card (default for MVP singles)

**Notes:**

- Automatic condition grading is a **non-goal** (see `NON_GOALS.md`).
- User selects condition during draft creation (may differ from `InventoryItem.condition` if multi-copy inventory).
- PSA/BGS/CGC grades = post-MVP (slabbed cards deferred).

---

### 3.5 `photos_json` (jsonb, required)

**Purpose:** User-captured listing photos (distinct from scan photo).

**Format:**

```json
["https://cdn.cardflow.app/listing-photos/abc123.jpg", "https://cdn.cardflow.app/listing-photos/def456.jpg"]
```

**Constraints:**

- Array of CDN/S3 URLs (CardFlow-hosted).
- Min 1 photo, max 12 photos (marketplace guidance).
- User uploads during draft creation.

**Image provenance:**

| Image Type | Source | Storage | Use |
|------------|--------|---------|-----|
| Scan photo | Recognition input | CardFlow CDN | Audit, deduplication |
| TCGdex catalog art | api.tcgdex.net | External URL ref only | Card detail display |
| **Listing photos** | **User upload** | **CardFlow CDN** | **Draft photos_json** |

**Notes:**

- Do **not** re-host TCGdex images as listing photos (link only in catalog display).
- User may capture same photo used for scan or upload new listing-quality photos.

---

### 3.6 `status` (enum, required)

**Purpose:** Draft lifecycle state.

**Enum values:**

- `draft` = In progress (user editing).
- `ready` = Reviewed and ready for manual publication.
- `archived` = Discarded or replaced.

**Transitions:**

```
draft → ready (user reviews and approves)
draft → archived (user discards)
ready → archived (user decides not to publish)
```

**Notes:**

- No `published` or `listed` status in MVP (deferred to post-MVP marketplace integration).
- User manually copies `ready` draft to eBay/Whatnot/etc. (outside CardFlow).

---

### 3.7 `quantity_to_list` (int, nullable)

**Purpose:** How many copies to list (when InventoryItem.quantity > 1).

**Constraints:**

- Must be ≤ `InventoryItem.quantity`.
- Nullable (default = all copies in inventory).

**Example:**

- User owns 5x Pikachu Base Set #58.
- User creates draft for 3x → `quantity_to_list: 3`.
- Remaining 2x stay in inventory.

**Assumption:** Partial-quantity listing UX = product decision (TBD).

---

### 3.8 `shipping_price_cents` (int, nullable)

**Purpose:** User shipping charge (if applicable for marketplace).

**Constraints:**

- USD cents (int, not float).
- Nullable (default = free shipping or marketplace-calculated).

**Example:** `shipping_price_cents: 400` = $4.00 shipping.

**Assumption:** Shipping calculation UX = product decision (TBD).

---

### 3.9 `notes` (text, nullable)

**Purpose:** Internal notes for user only (not included in published listing).

**Constraints:**

- Plain text, no length limit (reasonable UX guidance).
- User-entered (e.g. "Ship with extra bubble wrap", "Hold for bulk lot").

---

## 4. What Must NOT Be Included

### 4.1 Marketplace-Specific Fields (Deferred)

**Do not invent:**

- eBay category id, item specifics, shipping templates, payment policies.
- Whatnot stream id, auction start time, reserve price.
- TCGplayer product condition id, direct shipping settings.
- Shopify variant id, SKU, inventory location id.

**Rationale:** Auto-publish is a non-goal for MVP. Drafts = CardFlow-internal only.

---

### 4.2 Automatic Data Population (Future)

**Do not assume auto-fill for MVP:**

- Title auto-generated from catalog data (user-entered only).
- Description templates or AI assist (nice-to-have, not required).
- Photo background removal or enhancement (not MVP).

**Rationale:** MVP validates reviewed drafts. Auto-fill = later optimization.

---

### 4.3 External Listing IDs (Post-MVP)

**Do not store before publication:**

- `marketplace_listing_id` = null until user publishes (manual or API).
- `listing_url` = null until published.
- `listed_at` = null until published.

**Rationale:** Drafts are unpublished by definition. Track publication fields only after integration.

---

## 5. Draft Creation Flow (MVP UX)

1. User views **Inventory** → selects acquired item → taps **Create Draft**.
2. CardFlow pre-fills:
   - Catalog data (name, set, number) for reference.
   - `asking_price_cents` = suggested from Max Buy or estimate (user editable).
   - `condition` = copied from `InventoryItem.condition` (user editable).
   - `quantity_to_list` = `InventoryItem.quantity` (user editable).
3. User enters:
   - `title` (plain text, max 80 chars).
   - `description` (plain text, max 5000 chars).
   - `photos_json` (upload 1-12 photos).
   - `shipping_price_cents` (optional).
   - `notes` (optional).
4. User taps **Save Draft** → `ListingDraft.status = draft`.
5. User reviews → taps **Mark Ready** → `status = ready`.
6. User manually copies draft content to eBay/Whatnot/etc. (outside CardFlow).

**Assumption:** Pre-fill logic and UX copy = product decision (TBD).

---

## 6. Draft Display (MVP UX)

**Drafts Tab:**

```
Pikachu Base Set #58 (Draft)
  Asking Price: $5.00
  Condition: NM
  Quantity: 3x
  Status: Ready
  Photos: 4
  [Edit] [Copy to Clipboard] [Archive]
```

**Copy to Clipboard action (assumption):**

- Formats draft content for marketplace paste:

```
Title: Pikachu Base Set #58 English Common Raw NM

Description:
English Pokémon TCG card in Near Mint condition.
From Base Set, card #58 (Common).
Ships in sleeve + toploader via USPS First Class.

Price: $5.00
Shipping: $4.00
```

**Assumption:** Copy/export format = product decision (TBD).

---

## 7. Relationship to InventoryItem

### One Draft Per Inventory Row (MVP)

**Constraint:** `inventory_item_id` is **unique** for MVP.

**Rationale:**

- MVP = one listing draft per card identity/variant.
- User may edit and re-save draft (no multi-draft history).
- Future: allow multiple drafts per item (draft versions or marketplace-specific drafts).

---

### Draft Does NOT Change Inventory Status

**InventoryItem.status remains `purchased`** when draft is created.

**Rationale:**

- Draft creation ≠ listing publication.
- Inventory ownership unchanged until sold (post-MVP).

---

## 8. Draft Constraints

| Constraint | Validation | Notes |
|------------|------------|-------|
| `title` length | Max 80 chars | eBay title limit guidance |
| `description` length | Max 5000 chars | Reasonable listing limit |
| `asking_price_cents` | > 0 | Must be positive |
| `quantity_to_list` | ≤ `InventoryItem.quantity` | Cannot list more than owned |
| `photos_json` length | Min 1, max 12 | Marketplace photo limits |
| `inventory_item_id` uniqueness | Unique for MVP | One draft per item |

---

## 9. JSON Fixture Example

See `packages/shared/fixtures/crm-listing-draft-example.json` for full mock data.

---

## 10. Unknowns / Founder Decisions Needed

1. **Title auto-fill** from catalog data vs user-entered only.
2. **Description templates** or AI assist for flippers.
3. **Photo requirements** — min/max count, aspect ratio guidance.
4. **Shipping price calculation** — flat rate vs marketplace-calculated.
5. **Copy to Clipboard format** — plain text vs HTML vs JSON export.
6. **Multi-draft support** — allow multiple drafts per item or enforce 1:1.
7. **Draft versioning** — track edit history or single current draft only.

---

**Version:** 2026-09-12  
**Next:** See `crm-listing-draft-example.json` for mock fixture.
