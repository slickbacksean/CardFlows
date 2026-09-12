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
| `title` | Catalog: `{name} - {set.name} #{local_id} [{selected_variant or "Raw"}] EN` | Optional edit; **Confirmed:** required for `ready_for_review` |
| `description` | Partial catalog lines + empty user body (see §4) | **Confirmed:** optional for `ready_for_review` |
| `condition` | Inventory `condition` if present | Optional edit; **Confirmed:** required for `ready_for_review` |
| `asking_price` | Empty (user estimate) | **Confirmed:** required for `ready_for_review` |
| `currency` | Purchase / prefs (ISO 4217) | Rarely |
| `photos` | Optional reuse of `user_capture` by ref; empty listing photos | User adds `user_listing_photo` as needed; **Confirmed:** optional for `ready_for_review` |
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

**Confirmed (founder 2026-09-12):** No new `keywords` column. Helper **chips** the user can copy into `description`. Schema later only if people actually use them.

Examples for English raw singles: card name, set, number, "raw", "English", variant label.

| Decision | Status |
|----------|--------|
| New required DB column `keywords` | **Confirmed: no** for MVP |
| Helper UX | **Confirmed:** chips → copy into `description` |
| Schema later | Only if usage justifies it |

---

## 6. Optional AI-assisted description

**Confirmed (founder 2026-09-12):** Keep AI copy **OFF**. Ship templates and the disclosure checklist first. Do **not** dogfood AI until the confirm → purchase → draft loop is in use.

| | Rule |
|---|------|
| MVP | `listing_ai_copy_enabled` default **OFF** — no dogfood |
| Inputs allowed (later) | Catalog cache; user condition / disclosure answers; user notes they opt to send |
| Outputs allowed (later) | Suggestions the user must accept/edit before save |
| Must never invent | Prices, grades (PSA 10, BGS, CGC), authenticity guarantees, profit, marketplace fees, scraped comps, fake photo claims |

**Validation:** Any future AI path needs product + legal review before marketing claims.

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

## 12. Founder decisions (Confirmed 2026-09-12)

| Topic | Decision |
|-------|----------|
| Draft source | **Purchased-only.** Watchlist → Purchased first, then draft. |
| `ready_for_review` required | **`title`, `condition`, `asking_price`.** Description and photos optional. |
| Draft cardinality | **One active draft per copy.** Edit in place. No history in MVP. |
| Keywords | **No new column.** Helper chips copy into `description`. |
| AI copy | **OFF.** Templates + checklist first. No AI dogfood until confirm → purchase → draft is in use. |
| Clipboard | Tap **Copy** only; title / description / condition / asking; never private `notes`. See `LISTING_EXPORT_AND_COPY.md`. |
| CSV | **Clipboard-only for beta.** Marketplace CSV formats later. |
| Disclosure checklist | **Ship short optional checklist** — see `LISTING_CONDITION_DISCLOSURE.md`. |
| Second title template | **Yes, optional** — identity default; optional `{condition}` append — see `LISTING_TITLE_TEMPLATES.md`. |

---

## 13. Open questions (remaining)

- Whether spread UI shows on create, edit, and ready_for_review equally.
- Abandoned draft behavior and inventory state revert.
- Whether private `notes` may auto-seed with an all-in cost reminder (still never on clipboard).
- Exact overall grade vocabulary (NM/LP/MP/HP/DMG chips vs free text).
- Whether authenticity affirmation is prompted (optional) or omitted from the short checklist.

---

**Version:** 2026-09-12 (founder decisions locked)  
**Spike deliverable for review** — Builder behavior only; no production screens, no publish APIs, no migrations.
