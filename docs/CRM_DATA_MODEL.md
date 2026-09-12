# CardFlow CRM Data Model

**Status:** Spike documentation (no migrations; table sketches only)  
**Version:** 2026-09-12  
**Related:** See `CRM_INVENTORY_GRAIN.md`, `CRM_WORKFLOW_STATES.md`, `CRM_LISTING_DRAFT_FIELDS.md`

---

## 1. Overview

CardFlow owns the **CRM / inventory system of record** for:

- Scans (recognition attempts)
- Confirmations (user validates card identity)
- Canonical cards (internal CardFlow card entities)
- Inventory items (Purchased or Watchlist entries)
- Purchases (transaction records with all-in cost)
- Price snapshots (estimate data when available)
- Listing drafts (reviewed, not auto-published)
- User preferences (Max Buy rules, storage locations, tags)

**Hard rules:**

1. **Never key inventory, purchases, drafts, or URLs on a CardSight UUID or TCGdex id alone.**
2. CardFlow must mint and own its own **`cardflow_card_id`** (UUID) as the internal primary key.
3. Human **confirmation is required** before Purchased / Watchlist / inventory write.
4. CardSight UUIDs = external recognition refs (nullable until matched).
5. TCGdex ids = official Pokémon catalog refs (nullable until matched).
6. Do **not** assume CardSight IDs match TCGdex IDs.
7. MVP = English raw Pokémon singles only.

---

## 2. Entity Relationships

```
User
  └─ UserPreferences (Max Buy rules, storage locations, tags)
  └─ Scan (manual/camera photo)
        ├─ RecognitionAttempt (CardSight call)
        │     └─ RecognitionCandidate (0+ CardSight candidates)
        └─ Confirmation (user selects/rejects)
              └─ CanonicalCard (minted on confirm only)
                    ├─ CatalogCache (TCGdex snapshot)
                    ├─ PriceSnapshot (estimate data when available)
                    ├─ InventoryItem (Purchased | Watchlist)
                    │     ├─ Purchase (transaction with all-in cost)
                    │     └─ StorageLocation (user-defined)
                    └─ ListingDraft (reviewed, no publish)
  └─ CorrectionAudit (provider conflicts, user overrides)
```

---

## 3. Entities

### 3.1 Scan

**Purpose:** User-initiated recognition attempt (manual scan or camera photo).

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `scan_id` | UUID | CardFlow | PK |
| `user_id` | UUID | CardFlow | FK to User |
| `image_url` | string | CardFlow | User-captured scan photo (CDN/S3) |
| `image_fingerprint` | string | CardFlow | Deduplication hash (optional) |
| `scan_method` | enum | CardFlow | `manual_scan` \| `camera_photo` |
| `created_at` | timestamp | CardFlow | — |

**Notes:**

- Each scan represents one user image upload.
- `image_url` = user's scan photo (CardFlow-hosted).
- Do **not** store raw CardSight API keys or secrets.

---

### 3.2 RecognitionAttempt

**Purpose:** CardSight API call for one scan.

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `recognition_attempt_id` | UUID | CardFlow | PK |
| `scan_id` | UUID | CardFlow | FK to Scan |
| `provider` | string | CardFlow | `cardsight` \| `mock` |
| `vendor_request_id` | string (nullable) | CardSight | Vendor correlation id |
| `processing_time_ms` | int (nullable) | CardSight | — |
| `ok` | boolean | CardFlow | Success vs error |
| `error_code` | string (nullable) | CardFlow | `PROVIDER_TIMEOUT` \| `RATE_LIMITED` \| etc. |
| `error_message` | string (nullable) | CardFlow | User-safe error message |
| `created_at` | timestamp | CardFlow | — |

**Notes:**

- One scan may have 0+ recognition attempts (retries).
- `ok: false` → `error_code` + `error_message` present; no candidates.
- `ok: true` + `candidates: []` → no card detected (still success).

---

### 3.3 RecognitionCandidate

**Purpose:** Individual candidate returned by CardSight for one recognition attempt.

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `recognition_candidate_id` | UUID | CardFlow | PK |
| `recognition_attempt_id` | UUID | CardFlow | FK to RecognitionAttempt |
| `vendor_card_id` | string (nullable) | CardSight | CardSight UUID (external ref only) |
| `confidence` | enum (nullable) | CardSight | `High` \| `Medium` \| `Low` |
| `match_level` | enum | CardSight | `exact` \| `set` \| `none` |
| `name` | string (nullable) | CardSight | Card name |
| `set_name` | string (nullable) | CardSight | Set name |
| `number` | string (nullable) | CardSight | Card number |
| `language` | string (nullable) | CardSight | ISO code (`en`) |
| `rank` | int (nullable) | CardSight | 0 = best candidate |
| `fields_json` | jsonb | CardSight | Additional fields (RARITY, SET_YEAR, etc.) |

**Notes:**

- `vendor_card_id` is **not** a primary key for CardFlow entities.
- Multiple candidates per attempt for Medium/Low confidence.
- High exact match typically returns 1 candidate with `rank: 0`.

---

### 3.4 Confirmation

**Purpose:** User validates or rejects a recognition candidate.

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `confirmation_id` | UUID | CardFlow | PK |
| `scan_id` | UUID | CardFlow | FK to Scan |
| `recognition_candidate_id` | UUID (nullable) | CardFlow | FK to RecognitionCandidate (null if manual fallback) |
| `user_id` | UUID | CardFlow | FK to User |
| `action` | enum | CardFlow | `confirmed` \| `rejected` \| `manual_search` |
| `created_at` | timestamp | CardFlow | — |

**Notes:**

- **One confirmation per scan** (user picks or rejects).
- `action: confirmed` → mints `CanonicalCard` (see 3.5).
- `action: rejected` → user retries or uses manual search.
- `recognition_candidate_id: null` + `action: manual_search` → user fell back to search.

---

### 3.5 CanonicalCard

**Purpose:** CardFlow's internal card entity (minted on confirmation only).

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `cardflow_card_id` | UUID | CardFlow | **PK / internal identity** |
| `user_id` | UUID | CardFlow | FK to User (owner) |
| `confirmation_id` | UUID | CardFlow | FK to Confirmation |
| `tcgdex_id` | string (nullable) | TCGdex | Official catalog id (external ref) |
| `cardsight_card_id` | string (nullable) | CardSight | Vendor UUID (external ref) |
| `language` | string | CardFlow | ISO code (`en` for MVP) |
| `match_method` | enum | CardFlow | `identify` \| `manual` \| `import` |
| `created_at` | timestamp | CardFlow | — |
| `updated_at` | timestamp | CardFlow | — |

**Notes:**

- **`cardflow_card_id` is the primary key** for all inventory, purchases, drafts, URLs.
- `tcgdex_id` + `cardsight_card_id` = external refs only (nullable until matched).
- Minted **only** after user confirmation (never on scan alone).
- `match_method: identify` = CardSight High exact match → TCGdex resolution succeeded.
- `match_method: manual` = user manual search fallback.
- `match_method: import` = bulk import (future).

---

### 3.6 CatalogCache

**Purpose:** Snapshot of TCGdex metadata for a canonical card.

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `catalog_cache_id` | UUID | CardFlow | PK |
| `cardflow_card_id` | UUID | CardFlow | FK to CanonicalCard |
| `tcgdex_id` | string | TCGdex | Official catalog id |
| `name` | string | TCGdex | Card name |
| `set_name` | string | TCGdex | Set name |
| `set_id` | string | TCGdex | Set id |
| `number` | string | TCGdex | Card number |
| `rarity` | string (nullable) | TCGdex | Rarity |
| `image_url` | string (nullable) | TCGdex | Official catalog art URL |
| `variants_json` | jsonb (nullable) | TCGdex | Variants (holo, reverse, etc.) |
| `cached_at` | timestamp | CardFlow | Snapshot timestamp |

**Notes:**

- Copied from TCGdex API response (snapshot, not live).
- `image_url` = official catalog art (not user scan photo).
- Do **not** invent TCGdex fields not documented by api.tcgdex.net.
- Cache staleness policy = TBD / Validation item.

---

### 3.7 PriceSnapshot

**Purpose:** Estimate data from a pricing provider (TBD) when available.

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `price_snapshot_id` | UUID | CardFlow | PK |
| `cardflow_card_id` | UUID | CardFlow | FK to CanonicalCard |
| `provider` | string | CardFlow | Pricing provider name (TBD) |
| `condition` | enum (nullable) | CardFlow | `NM` \| `LP` \| `MP` \| `HP` \| `DMG` |
| `low_price_cents` | int (nullable) | Provider | Low estimate (USD cents) |
| `market_price_cents` | int (nullable) | Provider | Market estimate (USD cents) |
| `high_price_cents` | int (nullable) | Provider | High estimate (USD cents) |
| `currency` | string | Provider | `USD` for MVP |
| `snapshot_at` | timestamp | CardFlow | When estimate was fetched |
| `created_at` | timestamp | CardFlow | — |

**Notes:**

- **Pricing provider is TBD / Validation item.**
- Do **not** invent provider fields or API access.
- Do **not** use TCGdex pricing as market data.
- MVP must work without live prices (identity + CRM only).
- Prices are **estimates**, never guarantees.

---

### 3.8 InventoryItem

**Purpose:** User's inventory entry (Purchased or Watchlist).

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `inventory_item_id` | UUID | CardFlow | PK |
| `user_id` | UUID | CardFlow | FK to User |
| `cardflow_card_id` | UUID | CardFlow | FK to CanonicalCard |
| `status` | enum | CardFlow | `purchased` \| `watchlist` |
| `quantity` | int | CardFlow | Default 1 for MVP raw singles |
| `condition` | enum | CardFlow | `NM` \| `LP` \| `MP` \| `HP` \| `DMG` \| `RAW` |
| `storage_location_id` | UUID (nullable) | CardFlow | FK to StorageLocation |
| `tags_json` | jsonb | CardFlow | `["raw", "slabbed", "sealed", "lot", "to-grade"]` |
| `notes` | text (nullable) | CardFlow | User notes |
| `created_at` | timestamp | CardFlow | — |
| `updated_at` | timestamp | CardFlow | — |

**Notes:**

- **Recommendation:** One row per `{cardflow_card_id, language, selected_variant}` — see `CRM_INVENTORY_GRAIN.md`.
- `status: purchased` → user confirmed purchase; FK to Purchase required.
- `status: watchlist` → user watching, not yet purchased; Purchase FK null.
- `quantity` = aggregated count for MVP raw singles (default 1).
- `condition` = user-entered (automatic grading is a non-goal).
- `tags_json` = MVP defaults to `["raw"]` for singles; `slabbed`, `sealed`, `lot`, `to-grade` = future.

---

### 3.9 Purchase

**Purpose:** Transaction record with all-in cost for a purchased inventory item.

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `purchase_id` | UUID | CardFlow | PK |
| `inventory_item_id` | UUID | CardFlow | FK to InventoryItem (unique) |
| `user_id` | UUID | CardFlow | FK to User |
| `purchase_price_cents` | int | CardFlow | Card price (USD cents) |
| `shipping_cents` | int (nullable) | CardFlow | Shipping cost |
| `tax_cents` | int (nullable) | CardFlow | Sales tax |
| `fees_cents` | int (nullable) | CardFlow | Platform/payment fees |
| `supplies_cents` | int (nullable) | CardFlow | Sleeves, toploaders, etc. |
| `all_in_cost_cents` | int | CardFlow | Sum of above (computed) |
| `currency` | string | CardFlow | `USD` for MVP |
| `purchase_date` | date | CardFlow | User-entered acquisition date |
| `vendor_name` | string (nullable) | CardFlow | Seller/shop name (user-entered) |
| `receipt_image_url` | string (nullable) | CardFlow | Receipt photo (CDN/S3) |
| `created_at` | timestamp | CardFlow | — |
| `updated_at` | timestamp | CardFlow | — |

**Notes:**

- **Assumption:** All-in cost = `purchase_price + shipping + tax + fees + supplies`.
- `purchase_price_cents` = card price only.
- `all_in_cost_cents` = computed field (may be denormalized for queries).
- Exact cost fields = **Assumption pending founder/UX decision**.
- MVP: 1 Purchase per InventoryItem (1:1 for singles).

---

### 3.10 StorageLocation

**Purpose:** User-defined storage locations for inventory.

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `storage_location_id` | UUID | CardFlow | PK |
| `user_id` | UUID | CardFlow | FK to User |
| `name` | string | CardFlow | "Binder A", "Safe", "Grading Queue" |
| `description` | text (nullable) | CardFlow | — |
| `created_at` | timestamp | CardFlow | — |

**Notes:**

- User-created; no default locations required.
- Nullable FK on InventoryItem (not every item needs a location).

---

### 3.11 ListingDraft

**Purpose:** Reviewed listing draft (no automatic publication to marketplaces).

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `listing_draft_id` | UUID | CardFlow | PK |
| `inventory_item_id` | UUID | CardFlow | FK to InventoryItem (unique for MVP) |
| `user_id` | UUID | CardFlow | FK to User |
| `title` | string | CardFlow | Draft listing title |
| `description` | text | CardFlow | Draft description |
| `asking_price_cents` | int | CardFlow | User asking price (USD cents) |
| `condition` | enum | CardFlow | `NM` \| `LP` \| `MP` \| `HP` \| `DMG` |
| `photos_json` | jsonb | CardFlow | `["url1", "url2"]` user photos |
| `status` | enum | CardFlow | `draft` \| `ready` \| `archived` |
| `created_at` | timestamp | CardFlow | — |
| `updated_at` | timestamp | CardFlow | — |

**Notes:**

- **MVP: drafts stay inside CardFlow** (no eBay/Whatnot/TCGplayer publish).
- Do **not** invent marketplace-publication fields (eBay listing id, Whatnot stream id, etc.).
- See `CRM_LISTING_DRAFT_FIELDS.md` for full field spec.
- `photos_json` = user photos (not TCGdex catalog art).
- `status: draft` = in progress; `ready` = reviewed, ready for manual copy/paste; `archived` = discarded.

---

### 3.12 UserPreferences

**Purpose:** User-configured Max Buy rules and preferences.

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `user_preferences_id` | UUID | CardFlow | PK |
| `user_id` | UUID | CardFlow | FK to User (unique) |
| `max_buy_rules_json` | jsonb | CardFlow | Max Buy config (see below) |
| `default_condition` | enum | CardFlow | `NM` \| `LP` \| etc. |
| `default_tags` | jsonb | CardFlow | `["raw"]` for MVP singles |
| `created_at` | timestamp | CardFlow | — |
| `updated_at` | timestamp | CardFlow | — |

**Max Buy Rules JSON (Assumption pending founder decision):**

```json
{
  "target_margin_pct": 30,
  "platform_fees_pct": 13,
  "shipping_buffer_cents": 300,
  "condition_adjustments": {
    "NM": 1.0,
    "LP": 0.85,
    "MP": 0.7,
    "HP": 0.5,
    "DMG": 0.3
  }
}
```

**Notes:**

- Max Buy = CardFlow-calculated guidance from user rules + estimate.
- **Assumption:** Exact rule fields pending founder decision.
- MVP must work without live pricing (show only catalog identity + manual input).

---

### 3.13 CorrectionAudit

**Purpose:** Track provider conflicts, user corrections, and mapping overrides.

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `correction_audit_id` | UUID | CardFlow | PK |
| `cardflow_card_id` | UUID | CardFlow | FK to CanonicalCard |
| `user_id` | UUID | CardFlow | FK to User |
| `correction_type` | enum | CardFlow | `provider_conflict` \| `user_override` \| `manual_correction` |
| `field_name` | string | CardFlow | `tcgdex_id` \| `name` \| `set_name` \| etc. |
| `old_value` | text (nullable) | CardFlow | Previous value |
| `new_value` | text | CardFlow | Corrected value |
| `reason` | text (nullable) | CardFlow | User notes / conflict reason |
| `created_at` | timestamp | CardFlow | — |

**Notes:**

- `correction_type: provider_conflict` = CardSight vs TCGdex mismatch (e.g. language, set).
- `correction_type: user_override` = user manually fixes incorrect recognition.
- `correction_type: manual_correction` = user edits after confirmation.
- See `crm-correction-audit-example.json` for conflict scenarios.

---

## 4. Key Design Decisions

### 4.1 When to Mint `cardflow_card_id`

**Recommendation:** Mint **only** on user Confirmation (action: confirmed).

**Rationale:**

- Scan alone does not guarantee card identity.
- Recognition candidates are provisional until user confirms.
- Confirmation = user commits identity → safe to mint internal entity.
- Do **not** mint on scan or recognition attempt (too early).

---

### 4.2 Inventory Grain

**See `CRM_INVENTORY_GRAIN.md` for full recommendation.**

**Summary:** One row per `{cardflow_card_id, language, selected_variant}` with aggregated `quantity`.

**Rationale:**

- MVP raw singles = fungible copies (no per-copy serial tracking).
- Aggregation simplifies UX for flippers (not grading slab businesses).
- Future: per-copy tracking for slabbed/graded = separate grain (not MVP).

---

### 4.3 Purchased vs Watchlist

| Status | Purchase FK | All-In Cost | Max Buy Shown | Use Case |
|--------|-------------|-------------|---------------|----------|
| `purchased` | Required | Yes | Past snapshot | User bought the card |
| `watchlist` | Null | No | Live guidance | User considering purchase |

**Notes:**

- Watchlist = no transaction record; only price snapshots + Max Buy guidance.
- Purchased = full transaction with all-in cost + receipt.

---

### 4.4 What Must Never Be Stored

**Prohibited:**

- CardSight API keys or raw secrets
- TCGdex pricing as "market truth" (use only as estimate snapshot)
- Marketplace login credentials, session cookies, payment tokens
- Raw CardSight binary payloads (store only mapped fields)
- Invented vendor fields not in official docs

**Required:**

- User-captured scan photos (CardFlow-hosted CDN/S3)
- Official TCGdex catalog art URLs (external refs, not re-hosted without permission)

---

### 4.5 Image Provenance

| Image Type | Source | Storage | Use |
|------------|--------|---------|-----|
| User scan photo | Camera/upload | CardFlow CDN | Recognition input, audit |
| TCGdex catalog art | api.tcgdex.net | External URL ref only | Card detail display |
| User listing photo | Camera/upload | CardFlow CDN | Listing draft photos |
| Receipt photo | Camera/upload | CardFlow CDN | Purchase audit |

**Notes:**

- Do **not** re-host TCGdex images without permission (link only).
- User photos = CardFlow-owned (CDN/S3 bucket).

---

## 5. Supporting Max Buy Without Live Pricing

**Scenario:** Pricing provider unavailable or TBD.

**MVP must still work:**

1. User scans card → confirms identity (TCGdex catalog shown).
2. User **manually enters** estimate or target price.
3. CardFlow applies Max Buy rules to user-entered estimate.
4. Max Buy = guidance from user config + manual input (not live market data).
5. User taps Purchased or Watchlist → CRM save succeeds.

**Assumption:** Manual price entry field in confirmation/purchase UX — product decision pending.

---

## 6. Table Sketch Summary

**Reminder:** This is a spike; do **not** create migrations or production schemas.

```
users
  └─ user_preferences

scans
  └─ recognition_attempts
        └─ recognition_candidates
  └─ confirmations
        └─ canonical_cards
              ├─ catalog_cache (TCGdex snapshot)
              ├─ price_snapshots (estimate data)
              ├─ inventory_items
              │     ├─ purchases (1:1 for MVP singles)
              │     └─ storage_locations (nullable FK)
              ├─ listing_drafts
              └─ correction_audits
```

**Notes:**

- All UUIDs = CardFlow-owned.
- External refs: `tcgdex_id`, `cardsight_card_id`, `vendor_request_id` = nullable strings.
- Timestamps: `created_at`, `updated_at`, `cached_at`, `snapshot_at`, `purchase_date`.
- Enums: align with TypeScript enums in shared package (implementation detail).

---

## 7. Unknowns / Founder Decisions Needed

1. **Exact Max Buy rule fields** (margin %, fees %, condition multipliers, shipping buffer).
2. **Pricing provider choice** and available estimate fields.
3. **All-in cost fields** — which are required vs optional for flippers.
4. **Cache staleness policy** for TCGdex catalog snapshots.
5. **Manual price entry** UX when pricing provider unavailable.
6. **Language detection** / hard-block UX for non-English cards in MVP.
7. **Watchlist alerts** on price changes (depends on pricing provider).
8. **Per-copy tracking** for slabbed/graded cards (future, not MVP grain).

---

**Version:** 2026-09-12  
**Next:** See `CRM_INVENTORY_GRAIN.md`, `CRM_WORKFLOW_STATES.md`, `CRM_LISTING_DRAFT_FIELDS.md` for deeper specs.
