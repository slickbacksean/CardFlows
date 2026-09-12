# CardFlow Listing Draft Builder

**Status:** Spike recommendation for review. **Internal CardFlow document only.**  
**Related:** `CRM_LISTING_DRAFT_FIELDS.md`, `CRM_WORKFLOW_STATES.md`, `LISTING_TITLE_TEMPLATES.md`, `LISTING_CONDITION_DISCLOSURE.md`, `LISTING_EXPORT_AND_COPY.md`, `NON_GOALS.md` (no automatic listing publication).

---

## 1. What the builder is

The listing draft builder is an **internal CardFlow screen flow** that helps the user prepare sell copy for a **Purchased** inventory copy.

It is **not** a marketplace publisher.

MVP:

- Opens only from a **Purchased** item (`intent = purchased`, workflow `acquired` or already `drafted`).
- Prefills from catalog cache + inventory condition / cost.
- User edits title, description, condition, asking price, photos, channel note, notes.
- User marks `ready_for_review` inside CardFlow.
- CardFlow does **not** post to eBay, Whatnot, TCGplayer, Shopify, or any other venue.
- Feature flag: `listing_drafts_enabled` (ON) — drafts only; no publish (`MVP_SCOPE.md`).

**Confirmed:** Drafts are not marketplace listings. No publish APIs in MVP.  
**Assumption:** Drafts start from **Purchased only** (not Watchlist), so every draft has a cost basis and a physical copy (`CRM_LISTING_DRAFT_FIELDS.md` §1).  
**Assumption:** One **active** draft per purchased copy.

---

## 2. Builder steps

```
Purchased item (acquired)
  → Open “Create listing draft”
  → Prefill from catalog cache + inventory condition / all-in cost
  → User edits fields + optional disclosure checklist
  → Status: draft
  → User marks Ready for review
  → Status: ready_for_review
  → Inventory workflow_state: drafted (on first draft insert)
```

| Step | What happens | Not allowed |
|------|--------------|-------------|
| Open Purchased item | Load inventory + confirmation + catalog display cache | Open from Watchlist; invent identity without confirm |
| Prefill | Fill draft fields from known CardFlow / catalog sources | Fill `asking_price` from TCGdex pricing or scrapers |
| User edits | Title, description, condition, asking price, photos, channel note, notes | Auto-publish on save |
| Ready for review | Status → `ready_for_review` | Status → `published` (does not exist) |

Human identity confirm already happened before the inventory row exists (`CRM_WORKFLOW_STATES.md`). The builder never re-runs CardSight or invents a card.

---

## 3. Prefill map (reuse `CRM_LISTING_DRAFT_FIELDS` only)

| Draft field | Prefill source | User must edit? |
|-------------|----------------|-----------------|
| `draft_id` | System UUID on insert | No |
| `inventory_item_id` | Purchased item | No (locked) |
| `user_id` | Session owner | No |
| `cardflow_card_id` | Copied from inventory item | No (locked) |
| `status` | `draft` on create | User moves to `ready_for_review` |
| `title` | Catalog: `{name} - {set.name} #{local_id} [{selected_variant or "Raw"}] EN` | Optional edit; **Assumption:** required for ready |
| `description` | Partial catalog lines + empty user body (see §4) | User completes |
| `condition` | Inventory `condition` if present | Optional edit; **Assumption:** required for ready |
| `asking_price` | Empty (user estimate) | **Assumption:** required for ready |
| `currency` | Purchase / prefs (ISO 4217) | Rarely |
| `photos` | Optional reuse of `user_capture` by ref; empty listing photos | User adds `user_listing_photo` as needed |
| `intended_channel_note` | Empty | Optional free text |
| `notes` | Empty (may seed private cost reminder — **Assumption**) | Optional |
| `quantity` | `1` | Fixed for raw single MVP |
| `created_at` / `updated_at` | System | No |

Catalog **display** (read-through cache, not draft-authored columns):

- `name`, set name, `local_id`, language, rarity, `selected_variant`
- TCGdex constructed image with `image.source = tcgdex_assets` and `notAUserListingPhoto: true`

Do **not** fork new required schema columns for builder-only helpers.

---

## 4. Description template

### Catalog-prefilled (safe, factual)

May auto-insert as editable starter text:

- Card name, set name, local id, language (EN), selected variant or “Raw”
- Optional: inventory condition if already set

Example starter:

```
Pikachu — Base Set #58 — English — normal (Raw)
Condition: NM
```

### User-must-type (do not invent)

- Wear details beyond the condition label (corners, edges, surface, centering notes)
- Storage / provenance the user wants to disclose (“from my binder”)
- Photo statement (“Photos are mine”)
- Any authenticity affirmation (user affirmation only — not a CardFlow guarantee)
- Channel-specific sell copy

**Never** auto-write: PSA/BGS grades, “mint gem”, “guaranteed authentic”, profit claims, scraped comps, marketplace fee schedules.

---

## 5. Keywords / search terms (optional helper)

**Assumption / optional helper — not in `CRM_LISTING_DRAFT_FIELDS`.**

CardFlow may offer a **helper list** of search terms the user can copy into `description` or keep in `notes`. Examples for English raw singles: card name, set, number, “raw”, “English”, variant label.

| Decision | Recommendation |
|----------|----------------|
| New required DB column `keywords` | **Do not** invent for MVP |
| Store helper selections | Prefer copy-into-`description`, or private `notes`, or ephemeral UI-only clipboard |
| Schema alignment | If persisted later, mark as founder decision and schema change — out of this spike’s authoritative field list |

---

## 6. Optional AI-assisted description

**Recommendation: LATER / feature-flagged OFF for MVP** unless the founder explicitly turns it on.

| | Rule |
|---|------|
| Inputs allowed | Catalog cache fields already on the draft screen; user-entered condition / disclosure checklist answers; user notes the user opts to send |
| Outputs allowed | Draft prose suggestions the user must accept/edit before save |
| Must never invent | Prices, grades (PSA 10, BGS, CGC), authenticity guarantees, profit, marketplace fees, scraped comps, fake photo claims |
| Flag | `listing_ai_copy_enabled` default **OFF** |

**Validation:** Any AI path needs product + legal review before beta marketing claims.  
**Confirmed:** AI copy is not required to ship drafts.

---

## 7. Asking price vs all-in spread (UI rules)

| Rule | Detail |
|------|--------|
| `asking_price` | User estimate of what they might ask. Not live market. Not a guarantee. |
| Compare to | Purchase `all_in_total` when present |
| Label | **spread** or **cost-to-ask gap** only |
| Never label | profit, guaranteed profit, ROI as a promise |
| Never fill from | TCGdex `pricing`, scrapers, invented comps |

Example (Pikachu fixture): all-in `4.04` USD, asking `9.00` → spread `4.96` USD (cost-to-ask gap).

UI may show:

```
Asking: $9.00
All-in cost: $4.04
Spread (cost-to-ask gap): $4.96
```

Do not color-code as “profit green” in MVP copy.

---

## 8. Photo rules

| Source | `image.source` | Allowed on draft |
|--------|----------------|------------------|
| New photos user adds for the draft | `user_listing_photo` | Yes |
| Original scan, referenced (not re-labeled as catalog art) | `user_capture` | Yes |
| TCGdex catalog art | `tcgdex_assets` | Screen display only — **never** as a listing photo the user “took” |

- Do not download/rehost the TCGdex assets tree to “help” the draft.
- Prefer showing `notAUserListingPhoto: true` on catalog art in the builder chrome.

---

## 9. Channel note rules

- Field: `intended_channel_note` — free text (“maybe eBay later”).
- **Not** a publish-target enum wired to an API.
- Saving a note does **not** create marketplace ids or set `published`.
- User may later paste an external URL into `notes`; that is still not CardFlow publishing.

---

## 10. Forbidden fields (MVP forever for this spike)

Do not invent these as if CardFlow posted a listing:

- `ebay_item_id`, `ebay_listing_id`, eBay-tied `sku`
- `whatnot_show_id`, `whatnot_product_id`
- `tcgplayer_listing_id` / publish keys; Shopify product/variant ids
- `published_at`, `ended_at`, `relisted_at`
- `marketplace_listing_url` as a system-owned post URL
- `auto_publish`, `publish_on_save`, `scheduled_publish_at`
- Bid / buy-it-now / offer-auto-accept automation fields
- Payment / payout account ids
- TCGdex `pricing` copied into `asking_price`

Clipboard / CSV export later is **not** publication (`LISTING_EXPORT_AND_COPY.md`).

---

## 11. Workflow tie-in

| Event | Inventory `workflow_state` | Draft `status` |
|-------|----------------------------|----------------|
| Purchased saved | `acquired` | (no draft yet) |
| First draft insert | → `drafted` | `draft` |
| User edits | stays `drafted` | `draft` |
| User marks reviewed | stays `drafted` | `ready_for_review` |
| Optional later abandon | may return to `acquired` if no other draft | `abandoned` (later) |

There is **no** `published` draft status and **no** inventory `listed` state in MVP (`CRM_WORKFLOW_STATES.md`).

Scope reminder: English raw Pokémon singles only; CardSight recognition-only; TCGdex catalog only.

---

## 12. Founder decisions

1. Purchased-only drafts (recommended) vs allow Watchlist drafts.  
2. Required fields for `ready_for_review` (title / condition / asking_price recommended).  
3. One active draft per copy (recommended) vs draft history.  
4. Keywords helper: UI-only vs copy-into-description vs later schema.  
5. AI-assisted description: stay OFF for MVP (recommended) vs limited dogfood.  
6. Clipboard export timing relative to private beta.  
7. Whether private notes may auto-seed with all-in cost reminder.

---

## 13. Open questions

- Exact disclosure checklist UX vs plain `condition` text field (`LISTING_CONDITION_DISCLOSURE.md`).  
- Whether spread UI shows on create, edit, and ready_for_review equally.  
- Photo minimum for `ready_for_review` (recommended: none required).  
- Abandoned draft behavior and inventory state revert.

---

**Version:** 2026-09-12  
**Spike deliverable for review** — Builder behavior only; no production screens, no publish APIs, no migrations.
