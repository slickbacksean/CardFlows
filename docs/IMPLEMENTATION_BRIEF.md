# CardFlow implementation brief

**Status:** Frozen for private-beta build.  
**Read this first.** Do not reread the full `docs/` tree unless this file points you to one doc. Do not rewrite planning docs.

## Product loop (MVP)

Scan or camera photo → CardSight candidates → TCGdex match → user Confirm → Max Buy guidance → Purchased or Watchlist → later listing draft → Copy. No marketplace publish.

English raw Pokémon singles only. Still image only. Native iOS/Android (Expo).

## IDs (never collapse)

| ID | Role |
|----|------|
| `cardflow_card_id` | CardFlow UUID. Mint **on Confirm only**. PK for CRM. |
| `tcgdex_id` | Catalog ref only (e.g. `base1-58`). |
| `cardsight_card_id` | Recognition ref only. Never look up TCGdex with it. |

Never key inventory, purchases, drafts, or URLs on CardSight or TCGdex alone.

## Inventory grain

- Canonical card: one row per `{language, tcgdex_id}` (`en` for MVP).
- Purchased: **one row per physical copy** (`quantity: 1`, `tags: ["raw"]`).
- Watchlist: one interest row per `{user, cardflow_card_id, selected_variant}`. Not stock. No cost basis.

Scan/confirm without Purchased or Watchlist does **not** create an inventory item.

## Workflow (MVP)

- Pre-inventory: `scan_captured` → `identity_confirmed` (or reject).
- Watchlist: `watching` → `watchlist_closed`.
- Purchased: `acquired` → `drafted` (on first draft insert).
- Later (do not build): `listed`, `sold`, `shipped`, `paid_out`.

## Max Buy

```
max_buy = round_half_up_cent(
  reference_price × (1 − 0.20) × (1 − 0.13) × condition_factor
)
```

Defaults: margin `0.20`, fees buffer `0.13`, `condition_factor` `1.0` unless optional map. Currency `USD`. Persist cents, display dollars. Missing reference: still save; show “enter a reference price.” Recompute from current prefs + stored reference. Never use TCGdex pricing, CardSight, or scraped markets.

## All-in cost

`all_in_total = purchase_price + shipping + tax + fees + supplies`  
Required to save Purchased: `currency`, `purchase_price`, `purchased_at`. Optional lines default `0`.

## Listing drafts

- Purchased only. One active draft per copy.
- `ready_for_review` requires `title`, `condition`, `asking_price`.
- Default title: `{name} - {set.name} #{local_id} [{selected_variant or "Raw"}] EN`. Optional second template appends `{condition}`.
- Optional disclosure checklist writes into condition/description. No grade table.
- Keywords: helper chips copied into `description`. No `keywords` column.
- AI copy: flag **OFF**.
- Copy on user tap only: title, description, condition, asking_price. Never private `notes`. No CSV in beta.
- Asking vs all-in = **spread**, never “profit.”
- No eBay / Whatnot / TCGplayer / Shopify publish fields.

## Providers

- CardSight: still-image identify only. Server-side. Mock first (`packages/shared/fixtures/cardsight-*.json`).
- TCGdex: public API/SDK later. Mock first (`tcgdex-*.json`). Strip any `pricing`.
- Mapper: language + set + localId + name + variant. Never name-only. High still needs Confirm.
- Pricing provider: **OFF**.

## Must never

Live CardSight keys in the client. Self-host TCGdex. Full catalog import. Marketplace scrape/login/auto-list. Auto grading. Profit guarantees. Rewrite of planning docs as the task.

## First build slice (do this, not more)

1. Expo app + API package + shared package.
2. Mock recognition, mock catalog/mapper, Max Buy function, fixtures tests.
3. No production vendor HTTP. Persistence may start with local/dev storage if needed for the first screen loop.

Detail docs only if blocked: `CRM_DATA_MODEL.md`, `CARD_ID_MAPPING_PLAN.md`, `MAX_BUY_CALCULATOR.md`, `LISTING_DRAFT_BUILDER.md`.
