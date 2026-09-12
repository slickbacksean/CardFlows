# CardFlow Listing Draft Fields

**Status:** Spike recommendation for review. **Internal CardFlow document only.**  
**Related:** `CRM_DATA_MODEL.md`, `CRM_WORKFLOW_STATES.md`, `NON_GOALS.md` (no automatic listing publication).

---

## 1. What a draft is

A listing draft is a **reviewed document inside CardFlow** that helps the user prepare to sell later. It is not a marketplace listing.

MVP:

- User creates the draft from a **Purchased** inventory item.  
- User edits and marks `ready_for_review`.  
- CardFlow does **not** post to eBay, Whatnot, TCGplayer, Shopify, or any other venue.  
- Feature flag: `listing_drafts_enabled` (ON) — drafts only; no publish (`MVP_SCOPE.md`).

**Assumption:** Drafts are **not** allowed from Watchlist until the user converts to Purchased (`CRM_DATA_MODEL.md` §7). `MVP_SUCCESS_METRICS.md` leaves this open; this spike recommends Purchased-only so drafts always have a cost basis and a physical copy.

---

## 2. Allowed fields (CardFlow-owned)

| Field | Required to create? | Required for `ready_for_review`? | Notes |
|-------|---------------------|----------------------------------|-------|
| `draft_id` | System | System | CardFlow UUID |
| `inventory_item_id` | Yes | Yes | Purchased copy only |
| `user_id` | Yes | Yes | Owner |
| `cardflow_card_id` | Yes | Yes | Copied from the item; never a CardSight/TCGdex-only key |
| `status` | Yes (`draft`) | `ready_for_review` | Internal only |
| `title` | No | **Assumption:** yes | User-edited. May default from catalog `name` + set + `local_id` |
| `description` | No | No | User text. No scraped marketplace boilerplate. |
| `condition` | No | **Assumption:** yes | User-entered; may copy from the inventory item |
| `asking_price` | No | **Assumption:** yes | User-entered **estimate** of what they might ask. Not a live market, not a guarantee. |
| `currency` | Yes (default prefs) | Yes | ISO 4217 |
| `photos` | No | No | `user_listing_photo` and/or reuse of `user_capture` **by reference**. Never TCGdex art presented as the user’s photo. |
| `intended_channel_note` | No | No | Free text (“maybe eBay later”). **Not** a publish target enum wired to an API. |
| `notes` | No | No | Private notes, not shown as a listing body unless copied into `description` |
| `quantity` | Default `1` | `1` | Raw single. Do not invent multi-SKU carts. |
| `created_at` / `updated_at` | System | System | Audit |

Catalog **display** on the draft screen (read-through, not draft-authored):

- Cached `name`, set name, `local_id`, language, rarity, `selected_variant`  
- TCGdex constructed image + `image.source = tcgdex_assets` + provenance  

Those are **copied catalog cache**, not listing-publication attributes.

---

## 3. Default title (Assumption)

```
{name} - {set.name} #{local_id} [{selected_variant or "Raw"}] EN
```

Example: `Pikachu - Base Set #58 [normal] EN`

User may edit freely. Do not generate marketplace SEO titles as if publishing.

---

## 4. Photos on a draft

| Source | `image.source` | Allowed |
|--------|----------------|---------|
| New photos the user adds for the draft | `user_listing_photo` | Yes |
| Original scan, **referenced** (not re-labeled as catalog art) | `user_capture` | Yes |
| TCGdex catalog art | `tcgdex_assets` | Display on the CardFlow screen only — **do not** store it as a listing photo the user “took” |

Do not download/rehost the TCGdex assets tree to “help” the draft.

---

## 5. Fields that must **not** exist in MVP

Do **not** invent these as if CardFlow posted a listing:

| Forbidden field | Why |
|-----------------|-----|
| `ebay_item_id`, `ebay_listing_id`, `sku` tied to eBay | No eBay API |
| `whatnot_show_id`, `whatnot_product_id` | No Whatnot API / scraping |
| `tcgplayer_product_id` as a publish key, `tcgplayer_listing_id` | Not a TCGplayer seller integration |
| `shopify_product_id`, `shopify_variant_id` | No Shopify |
| `published_at`, `ended_at`, `relisted_at` | No publication lifecycle |
| `marketplace_listing_url` as a system-owned post URL | User may paste a URL in `notes` later; that is not CardFlow publishing |
| `auto_publish`, `publish_on_save`, `scheduled_publish_at` | Explicit non-goal |
| `bid`, `buy_it_now_api`, `offer_auto_accept` | No marketplace automation |
| Payment / payout account ids | Forbidden |
| TCGdex `pricing` copied into `asking_price` | Not market truth |

A later “export checklist” (copy title/description to clipboard) is **not** publication and does not require those columns.

---

## 6. Table sketch (`crm_listing_drafts`)

**Not a migration.**

| Column | Owner | Purpose |
|--------|-------|---------|
| `draft_id` | CardFlow | PK |
| `inventory_item_id` | CardFlow | FK purchased item |
| `user_id` | CardFlow | Owner |
| `cardflow_card_id` | CardFlow | Identity (denormalized for list queries) |
| `status` | CardFlow | `draft` \| `ready_for_review` |
| `title` | CardFlow | User text |
| `description` | CardFlow | User text |
| `condition` | CardFlow | User text / later enum |
| `asking_price` | CardFlow | User estimate, minor units |
| `currency` | CardFlow | ISO 4217 |
| `quantity` | CardFlow | `1` |
| `photos_json` | CardFlow | Array of `{ storageRef, source, mimeType }` |
| `intended_channel_note` | CardFlow | Free text |
| `notes` | CardFlow | Private |
| `created_at` / `updated_at` | CardFlow | Audit |

On first insert of a draft for an `acquired` item, set inventory `workflow_state = drafted` (`CRM_WORKFLOW_STATES.md`).

**Assumption:** One **active** draft per purchased item in MVP (unique on `inventory_item_id` where not abandoned). Founder may later allow draft history.

---

## 7. Status values (internal)

| Status | Meaning |
|--------|---------|
| `draft` | Started; user still editing |
| `ready_for_review` | User marked it reviewed inside CardFlow |
| `abandoned` | Optional later; user discarded the draft (item may return to `acquired` if no other draft) |

There is no `published` status.

---

## 8. Founder decisions

1. Purchased-only drafts (recommended) vs allow Watchlist drafts.  
2. Which fields are required for `ready_for_review` (title / condition / asking_price recommended).  
3. One active draft per copy (recommended) vs many.  
4. Clipboard export later — still not a marketplace integration.

---

**Version:** 2026-09-12  
**Spike deliverable for review** — Draft field list only; no publish APIs, no screens.
