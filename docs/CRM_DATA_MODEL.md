# CardFlow CRM / Inventory Data Model

**Status:** Spike plan for review. **No production tables. No migrations.**  
**MVP:** English raw Pokémon singles. Human confirmation before Purchased / Watchlist / inventory write.  
**Out of this spike:** Prisma/Drizzle schemas, API routes, app screens, CardSight/TCGdex adapters, live keys, TCGdex `pricing` as market data.

Related: `MVP_SCOPE.md`, `NON_GOALS.md`, `PRODUCT_OVERVIEW.md`, `CARD_ID_MAPPING_PLAN.md`, `TCGDEX_ARCHITECTURE.md`, `CRM_INVENTORY_GRAIN.md`, `CRM_WORKFLOW_STATES.md`, `CRM_LISTING_DRAFT_FIELDS.md`.

---

## Legend

| Label | Meaning |
|-------|---------|
| **Confirmed** | Already decided in CardFlow product / mapping docs on `main`. |
| **Unconfirmed** | Depends on a later provider, legal review, or missing product spec. Do not invent. |
| **Assumption** | CRM recommendation in this spike, pending founder decision. |

---

## 1. Goals

1. CardFlow CRM is the **system of record** for scans, confirmations, purchases, watchlist, costs, locations, listing drafts, price snapshots, workflow status, and user Max Buy preferences.  
2. Every durable CRM row that represents a card identity or inventory action keys off **`cardflow_card_id`** (CardFlow UUID).  
3. CardSight UUIDs and TCGdex ids are **external refs only**. Never key inventory, purchases, drafts, or URLs on either alone.  
4. Do **not** assume a CardSight UUID equals a TCGdex id.  
5. Human **Confirm** is required before Purchased / Watchlist / inventory write.  
6. CRM must work **without** a live pricing provider.  
7. Sketch tables/columns only. This document is not a migration.

---

## 2. Ownership map

```
CardSight          recognition candidates only
                   cardsight_card_id = opaque external ref

TCGdex             official Pokémon catalog / metadata
                   tcgdex_id = catalog ref
                   catalog art URL + documented card fields
                   NEVER market pricing for CardFlow

CardFlow CRM       cardflow_card_id (internal PK)
                   scans, confirmations, inventory items
                   purchases, watchlist, all-in cost
                   storage locations, price snapshots
                   listing drafts, Max Buy rules, audit
```

This matches `PRODUCT_OVERVIEW.md` and `CARD_ID_MAPPING_PLAN.md`.

---

## 3. Entity catalog

| Entity | Owns | Created when | Keys |
|--------|------|--------------|------|
| **Canonical card** | Shared identity + catalog cache | First **Confirm** of `{language, tcgdex_id}` | `cardflow_card_id` |
| **Scan** | One capture + recognition + mapping attempt | Manual Scan / Camera Photo | `scan_id` |
| **Confirmation** | User-accepted identity for a scan | User taps Confirm (or picker / manual search pick) | `confirmation_id` |
| **Inventory item** | User’s Purchased copy **or** Watchlist interest | Purchased **or** Watchlist tap, after confirm | `inventory_item_id` |
| **Purchase** | Buy-side event + all-in cost | Purchased save | `purchase_id` |
| **Watchlist entry** | Interest fields on a watchlist item | Watchlist save | same `inventory_item_id` (`intent=watchlist`) |
| **Cost basis / all-in cost** | User-entered money lines | Purchased save (watchlist: omitted) | lives on `crm_purchases` |
| **Storage location** | User-named place | User creates a location; optional on item | `location_id` |
| **Price snapshot** | Estimate **or** user-entered reference | Optional, anytime after confirm | `snapshot_id` |
| **Listing draft** | Internal listing document | User starts a draft from a **Purchased** item | `draft_id` |
| **User preferences / Max Buy** | Rules + defaults | User account / first preferences save | `user_id` |
| **Audit event** | Confirmation / correction / conflict | Those events | `audit_id` |

**Assumption:** Watchlist is an inventory-item `intent`, not a second product home. Home / Inventory lists both intents. Physical-copy rules apply only to `intent=purchased`.

---

## 4. Field ownership (CardFlow vs cache vs external ref)

| Kind | Examples | Persistence rule |
|------|----------|------------------|
| **CardFlow-owned** | `cardflow_card_id`, `scan_id`, `confirmation_id`, `inventory_item_id`, `purchase_id`, `location_id`, `draft_id`, `user_id`, `intent`, `workflow_state`, `selected_variant`, `condition`, `quantity`, `tags`, cost lines, Max Buy rule fields, listing title/body/asking price, audit | Authoritative. Never replaced by a vendor id. |
| **Copied catalog cache** | `name`, `tcgdex_set_id`, `local_id`, `rarity`, `category`, `variants_json`, `image_base_url`, set name | Copied from TCGdex **after** a confirmed (or cached) catalog GET. Display/cache only. Re-fetch may refresh cache; do **not** change `cardflow_card_id`. Strip `pricing`. |
| **External provider refs** | `tcgdex_id`, `cardsight_card_id`, CardSight `vendorRequestId` | Store as refs on `card_external_ids` / scan. Never PK, never deep-link target, never inventory key. |

**Confirmed:** Language is stored next to `tcgdex_id` (`en` for MVP). Language is not inside the TCGdex id.

---

## 5. When to mint `cardflow_card_id`

**Recommendation (same as `CARD_ID_MAPPING_PLAN.md` §6 and founder item 5): mint or reuse only on Confirm.**

| Event | Mint `cardflow_card_id`? |
|-------|--------------------------|
| Scan captured | **No.** `cardflow_card_id` stays null. |
| CardSight High / mapper High proposal shown | **No.** Proposal may *preview* a catalog row; do not persist a new canonical card. |
| User **Confirms** a unique `{language, tcgdex_id}` | **Yes, if none exists.** Reuse if the unique `(language, tcgdex_id)` row already exists. Attach CardSight ref. |
| User rejects all candidates | **No.** |
| Catalog no-match / outage | **No.** Do not mint from CardSight alone. |
| Purchased / Watchlist | **No new mint.** Requires an already-confirmed `cardflow_card_id`. |

Scan and mapping fixtures may show a *preview* candidate without a persisted CardFlow UUID. Inventory, purchases, drafts, and URLs must not use a preview id.

---

## 6. When to create an inventory item vs only a scan / confirm

```
Capture  →  crm_scans
Confirm  →  crm_confirmations  +  cardflow_cards (mint/reuse)
Purchased / Watchlist  →  crm_inventory_items  (+ purchase / watchlist fields)
```

| Record | Always created? | Inventory item? |
|--------|-----------------|-----------------|
| Scan | Yes, on capture (success, empty detections, or provider error) | No |
| Confirmation | Only if the user confirms a catalog row | No |
| Inventory item | Only if the user taps **Purchased** or **Watchlist** after confirm | Yes |

A confirmed identity with no Purchased / Watchlist tap is a **scan + confirmation** only. It does not appear as owned inventory or watchlist. That keeps “I identified it” separate from “I bought it / I am watching it.”

**Assumption:** Leaving the Confirm screen without Purchased / Watchlist is a successful identity event for analytics, not activation (`MVP_SUCCESS_METRICS.md` still requires a save).

---

## 7. Purchased vs Watchlist

| | **Purchased** | **Watchlist** |
|--|---------------|---------------|
| Meaning | User owns (or just acquired) this copy | User is interested; not owned |
| Requires confirm | Yes | Yes |
| Creates inventory item | Yes (`intent=purchased`) | Yes (`intent=watchlist`) |
| Grain | **One row per physical copy** (see `CRM_INVENTORY_GRAIN.md`) | **One interest row** per `{user, cardflow_card_id, selected_variant}` |
| Quantity | Default **1** | Not an owned quantity (store `null`) |
| All-in cost / purchase | Required enough to save a purchase (see §8) | **Not stored** as cost basis |
| Storage location | Optional | Usually null |
| Listing draft | Allowed | **Not** from watchlist until converted to Purchased |
| Workflow | Starts `acquired` | Stays `watching` |
| Max Buy | Stored as guidance used at buy time | Stored as target / reminder |
| Convert | — | User may later tap Purchased (new purchased item + purchase row; watchlist item archived or closed) |

Do not silently turn a watchlist row into a purchased copy. Conversion is an explicit user action and a new purchased item (Assumption: close the watchlist row rather than mutate `intent` in place, so audit stays clear).

---

## 8. All-in cost fields

**Assumption** (`MVP_SCOPE.md`: exact cost fields pending founder/UX). Recommended buy-side lines for MVP:

| Field | Required on Purchased? | Notes |
|-------|------------------------|-------|
| `currency` | Yes | ISO 4217. Default from user preferences (`USD` Assumption for NA beta). |
| `purchase_price` | Yes | What the user paid for the card / lot line. |
| `shipping` | No (default `0`) | Inbound shipping allocated to this copy. |
| `tax` | No (default `0`) | Sales tax / VAT allocated to this copy. |
| `fees` | No (default `0`) | Buy-side platform or payment fees. **Not** a marketplace API fee. |
| `supplies` | No (default `0`) | Sleeves, toploaders, penny sleeves allocated to this copy. |
| `all_in_total` | Derived | Sum of the five money fields. Persist the computed total at save time. |
| `source_note` | No | Free text: “local shop”, “card show”, “online”. **Not** an eBay/Whatnot listing id. |
| `purchased_at` | Yes | User-entered or device timestamp. |
| `notes` | No | Free text. |

```
all_in_total = purchase_price + shipping + tax + fees + supplies
```

Rules:

- All amounts are **user-entered** in MVP. Do not scrape fees.  
- Do not pull TCGdex `pricing` into cost basis.  
- Watchlist does not write these fields.  
- **Assumption:** If the user bought a multi-card receipt, they allocate lines per copy (or enter purchase price only). No receipt-OCR in MVP.  
- **Assumption:** Money is integer **minor units** (cents) in persistence; fixtures show decimal strings for readability.

---

## 9. Quantity, condition, location, tags

| Field | MVP default | Rule |
|-------|-------------|------|
| `quantity` | `1` on purchased copies | Physical-copy grain. Do not use quantity as a substitute for per-copy cost/workflow. |
| `condition` | User-entered; nullable | Guided list later. **Not** automatic grading (`NON_GOALS.md`). |
| `location_id` | null | Optional FK to user-owned `crm_storage_locations`. |
| `tags` | `["raw"]` | MVP is raw singles. Other tags exist in the model but are **not** first-class MVP workflows. |

Allowed tag values (vocabulary; not all MVP):

| Tag | MVP? |
|-----|------|
| `raw` | **Default / only supported workflow** |
| `slabbed` | Later (graded slabs) |
| `sealed` | Later (sealed product) |
| `lot` | Later (multi-card lot as one saleable unit) |
| `to-grade` | Later (intent to submit) |

MVP should reject or ignore non-`raw` tags in write APIs until the founder expands (`NON_GOALS.md`: sports, Japanese, sealed, auto-grade are out).

**Assumption:** Condition enum for UI later (`NM`, `LP`, `MP`, `HP`, `DMG`, or a 10-point scale). Until then store a short user string + optional `condition_scale`. Do not invent PSA/BGS grades as product truth.

---

## 10. Image provenance

| Image | Record | `image.source` | Use |
|-------|--------|----------------|-----|
| User Manual Scan / Camera Photo | `crm_scans` | `user_capture` | Recognition + user history. **Never** official catalog art. |
| Extra listing photos | `crm_listing_drafts` | `user_listing_photo` | Draft only. **Never** official catalog art. |
| TCGdex card art | `cardflow_cards` | `tcgdex_assets` | Confirm / inventory thumbnail. Extension-less `baseUrl` + constructed URL. |

Rules (aligned with `TCGDEX_ARCHITECTURE.md` §7):

1. If TCGdex `image` is missing, show a placeholder — do not substitute the scan.  
2. Do not rehost the TCGdex assets tree in MVP.  
3. Do not claim CardFlow or TCGdex owns Pokémon artwork.  
4. Do not send scan bytes to third-party analytics (`MVP_SUCCESS_METRICS.md`).  
5. **Never** store CardSight raw multipart or API keys next to images.

---

## 11. How Max Buy works without a live pricing provider

Max Buy is **CardFlow-owned** user math. It must not require `pricing_provider_enabled`.

**Assumption** (rule shape pending founder decision):

```
reference_price   = user-entered comparable
                    OR last crm_price_snapshots.amount
                    OR null

max_buy           = reference_price
                    × (1 - target_margin_pct)
                    × (1 - fees_buffer_pct)
                    × condition_factor
```

| Input | Source | Required to save Purchased / Watchlist? |
|-------|--------|-----------------------------------------|
| `target_margin_pct` | User preferences | No (defaults **Assumption:** `0.20`) |
| `fees_buffer_pct` | User preferences | No (defaults **Assumption:** `0.13`) |
| `condition_factor` | Preferences map × user condition | No (default `1.0`) |
| `reference_price` | User typed **or** snapshot | **No.** If null, still save CRM; show “enter a reference price to compute Max Buy.” |

`crm_price_snapshots.source` allowed values:

- `user_entered` — MVP, always available  
- `later_provider` — only after a chosen pricing provider (**Validation item**)  
- **Never** `tcgdex_pricing`

Store a **rule snapshot** on the confirm/save event (`max_buy_amount`, `reference_price`, `reference_source`, copy of the rule percents) so later preference edits do not rewrite history.

Watchlist may store `target_max_buy` as a reminder. Do **not** alert on estimate changes until a pricing provider exists (`MVP_SCOPE.md` open question).

---

## 12. Confirmation, correction, and provider-conflict audit

Aligned with `CARD_ID_MAPPING_PLAN.md` §6–8.

| Event | Write | Audit |
|-------|-------|-------|
| First Confirm of a High proposal | Confirmation + mint/reuse canonical card; `match_method=identify` | `event_type=confirmation` |
| Picker / manual search pick | Confirmation; `match_method=manual` | `confirmation` |
| User picks a **different** catalog row than the proposal | Confirmation; `match_method=correction`; keep the scan | `correction` with previous vs new `tcgdex_id` |
| Reject all | No canonical write; no inventory | Optional `identity_reject` |
| Later re-scan maps to a **different** `tcgdex_id` than an existing inventory card | `mapping_status=provider_conflict`; **do not** retarget inventory | `provider_conflict`; user must confirm a correction |
| Correction after conflict | Update mapping refs; **do not** silently change other users’ canonical row meaning; inventory `cardflow_card_id` changes only if the user confirms retarget | `correction` |

**Never** auto-update `card_external_ids` or inventory on conflict.

Audit rows store old/new `tcgdex_id`, old/new `cardsight_card_id`, `match_method`, `mapping_status`, `scan_id`, `confirmation_id`, optional `inventory_item_id`. They do not store API keys or raw images.

---

## 13. What must never be stored

| Forbidden | Why |
|-----------|-----|
| CardSight API keys / `X-API-Key` / `CARDSIGHT_API_KEY` values | Secret. Server env only. |
| Raw CardSight secrets, full undocumented vendor blobs | Leak + license risk. Store **normalized** recognition DTO only. |
| TCGdex `pricing` / `variants_detailed` pricing | Not CardFlow market truth. Adapter strips it. |
| Marketplace credentials, cookies, session tokens | Non-goal; account automation forbidden. |
| Payment credentials / KYC documents | Out of MVP. |
| eBay / Whatnot / TCGplayer / Shopify listing-publication ids as if posted | Drafts are internal (`CRM_LISTING_DRAFT_FIELDS.md`). |
| Invented TCGdex or CardSight fields | Only documented vendor fields + CardFlow-owned columns. |
| Scan image bytes in analytics or catalog cache | First-party scan storage only; catalog art is TCGdex URLs. |

---

## 14. Persistence sketch (do not migrate yet)

When a later issue adds tables, use this sketch. **This spike does not create it.**

### 14.1 `cardflow_cards` (canonical identity + catalog cache)

Same unique grain as `CARD_ID_MAPPING_PLAN.md` §3.1: `(language, tcgdex_id)`.

| Column | Owner | Purpose |
|--------|-------|---------|
| `cardflow_card_id` | CardFlow | PK, UUID |
| `language` | CardFlow + catalog | TCGdex lang (`en`) |
| `tcgdex_id` | External ref | Official catalog id |
| `tcgdex_set_id` | Cache | Set id |
| `local_id` | Cache | Set number as text |
| `name` | Cache | Localized official name |
| `rarity` | Cache | Optional |
| `category` | Cache | Pokemon / Energy / Trainer |
| `variants_json` | Cache | Documented booleans only |
| `image_base_url` | Cache | Extension-less TCGdex asset URL |
| `image_source` | CardFlow | `tcgdex_assets` |
| `updated_at` | CardFlow | Cache time |

### 14.2 `card_external_ids`

| Column | Purpose |
|--------|---------|
| `cardflow_card_id` | FK |
| `provider` | `tcgdex` \| `cardsight` |
| `external_id` | `base1-58` or CardSight UUID |
| `set_external_id` | Optional |
| `language` | ISO / TCGdex code |
| `match_method` | `identify` \| `manual` \| `import` \| `correction` |
| `mapping_confidence` | High / Medium / Low / Unresolved |
| `updated_at` | Audit |

Unique: `(provider, external_id, language)` where meaningful.

### 14.3 `crm_scans`

| Column | Purpose |
|--------|---------|
| `scan_id` | PK |
| `user_id` | Owner |
| `captured_at` | Device/server time |
| `capture_method` | `manual_scan` \| `camera_photo` |
| `image_storage_ref` | First-party object key (not a vendor URL) |
| `image_source` | `user_capture` |
| `image_mime_type` | `image/jpeg` \| `image/png` \| `image/webp` |
| `recognition_json` | Normalized CardSight DTO (no secrets) |
| `mapping_status` | matched / ambiguous / no_match / provider_conflict / catalog_unavailable / pending |
| `mapping_confidence` | High / Medium / Low / Unresolved / null |
| `cardflow_card_id` | Null until confirm |
| `cardsight_card_id` | Nullable external ref |
| `vendor_request_id` | Opaque CardSight request id, not a secret |

### 14.4 `crm_confirmations`

| Column | Purpose |
|--------|---------|
| `confirmation_id` | PK |
| `scan_id` | FK |
| `user_id` | Owner |
| `cardflow_card_id` | Confirmed identity |
| `tcgdex_id` | Catalog ref at confirm time |
| `language` | `en` |
| `selected_variant` | `normal` \| `reverse` \| `holo` \| `firstEdition` \| null |
| `match_method` | `identify` \| `manual` \| `correction` |
| `mapping_confidence` | Mapper band at confirm |
| `previous_tcgdex_id` | Set on correction |
| `confirmed_at` | Timestamp |

### 14.5 `crm_inventory_items`

| Column | Purpose |
|--------|---------|
| `inventory_item_id` | PK |
| `user_id` | Owner |
| `cardflow_card_id` | Confirmed identity (**required**) |
| `confirmation_id` | How identity was accepted |
| `scan_id` | Originating scan (nullable if later import — import is out of MVP) |
| `intent` | `purchased` \| `watchlist` |
| `selected_variant` | Printing on **this** line |
| `condition` | User-entered |
| `quantity` | `1` purchased; `null` watchlist |
| `tags` | Default `['raw']` |
| `location_id` | Optional |
| `workflow_state` | See `CRM_WORKFLOW_STATES.md` |
| `target_max_buy_amount` | Watchlist reminder; optional on purchased (copy of computed Max Buy) |
| `closed_at` | Set when watchlist converts or item is archived |
| `created_at` / `updated_at` | Audit |

Purchased items are **not** unique on `cardflow_card_id` (many copies).  
Watchlist **Assumption:** unique open row on `(user_id, cardflow_card_id, selected_variant)` where `intent=watchlist` and `closed_at` is null.

### 14.6 `crm_purchases` (all-in cost)

| Column | Purpose |
|--------|---------|
| `purchase_id` | PK |
| `inventory_item_id` | FK, purchased intent only |
| `purchased_at` | When bought |
| `source_note` | Free text venue |
| `currency` | ISO 4217 |
| `purchase_price` | Minor units |
| `shipping` | Minor units |
| `tax` | Minor units |
| `fees` | Minor units |
| `supplies` | Minor units |
| `all_in_total` | Persisted sum |
| `notes` | Free text |
| `max_buy_amount` | Guidance used at save (nullable) |
| `reference_price_amount` | What Max Buy used (nullable) |
| `reference_price_source` | `user_entered` \| `later_provider` \| `none` |

### 14.7 `crm_storage_locations`

| Column | Purpose |
|--------|---------|
| `location_id` | PK |
| `user_id` | Owner |
| `name` | “Binder A / page 4” |
| `kind` | `binder` \| `box` \| `toploader_box` \| `showcase` \| `other` |
| `notes` | Free text |
| `archived_at` | Soft delete |

### 14.8 `crm_price_snapshots`

| Column | Purpose |
|--------|---------|
| `snapshot_id` | PK |
| `user_id` | Owner |
| `cardflow_card_id` | Identity |
| `inventory_item_id` | Optional line context |
| `source` | `user_entered` \| `later_provider` |
| `amount` | Estimate / comparable |
| `currency` | ISO 4217 |
| `captured_at` | When taken |
| `provider_name` | Null in MVP; later chosen provider only |
| `is_estimate` | Always `true` |

No TCGdex pricing column. No “guaranteed sale” field.

### 14.9 `crm_listing_drafts`

See `CRM_LISTING_DRAFT_FIELDS.md`. Internal document only. FK to a **purchased** `inventory_item_id`.

### 14.10 `crm_user_preferences`

| Column | Purpose |
|--------|---------|
| `user_id` | PK |
| `default_currency` | Assumption: `USD` |
| `default_language` | `en` |
| `max_buy_target_margin_pct` | Assumption: `0.20` |
| `max_buy_fees_buffer_pct` | Assumption: `0.13` |
| `max_buy_condition_adjustments_json` | Optional map |
| `default_inventory_tag` | `raw` |

### 14.11 `crm_audit_events`

| Column | Purpose |
|--------|---------|
| `audit_id` | PK |
| `user_id` | Actor |
| `event_type` | `confirmation` \| `correction` \| `provider_conflict` \| `identity_reject` |
| `scan_id` | Context |
| `confirmation_id` | Nullable |
| `inventory_item_id` | Nullable |
| `cardflow_card_id` | Nullable |
| `previous_tcgdex_id` / `new_tcgdex_id` | Correction / conflict |
| `previous_cardsight_card_id` / `new_cardsight_card_id` | Refs only |
| `match_method` | identify / manual / correction |
| `mapping_status` | Mapper status |
| `notes` | Short product note |
| `created_at` | Timestamp |

---

## 15. Safe mobile / API surface (later issue)

Return to the app:

- CardFlow ids (`cardflow_card_id`, `scan_id`, `inventory_item_id`, `draft_id`)  
- Display catalog cache (name, set, localId, variant, constructed image + provenance)  
- Intent, workflow, condition, location name, costs, Max Buy guidance  
- Draft fields in `CRM_LISTING_DRAFT_FIELDS.md`

**Do not** return: API keys, TCGdex `pricing`, raw vendor blobs, marketplace publish handles.

---

## 16. Founder decisions

1. **Inventory grain** — this spike recommends **one purchased row per physical copy**; confirm or override (`CRM_INVENTORY_GRAIN.md`).  
2. **Mint `cardflow_card_id`** — Confirm only (recommended) vs first High proposal.  
3. **All-in cost** — keep the five money lines vs purchase-price-only for beta.  
4. **Watchlist → Purchased** — close + new item (recommended) vs mutate `intent`.  
5. **Condition vocabulary** and whether drafts may start from watchlist (recommended: **no**).  
6. **Max Buy percents** and condition factors.  
7. **Sold / shipped / paid out** in private beta vs later (`CRM_WORKFLOW_STATES.md`).  
8. Default language when CardSight omits `CARD_LANGUAGE` (still open from mapping plan).  
9. Image retention period for `user_capture` (privacy Validation item).

---

**Version:** 2026-09-12  
**Spike deliverable for review** — Documentation + mock fixtures only; no production tables.
