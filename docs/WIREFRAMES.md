# CardFlow MVP wireframes

**Status:** Design validation. Product UX only — not the current four-route scaffold.  
**Related:** [MVP_SCOPE.md](./MVP_SCOPE.md) (screen list), [ROADMAP.md](./ROADMAP.md), [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md), [NON_GOALS.md](./NON_GOALS.md).  
**UI template:** [HoloDex - TCG Scan & Collect](https://apps.apple.com/us/app/holodex-tcg-scan-collect/id6747442689) (App Store id `6747442689`). Layout and chrome only.

Exact UX names and navigation were pending design validation. These frames are that validation artifact. Do not treat them as shipped UI.

Implement in order: [WIREFRAME_TASKS.md](./WIREFRAME_TASKS.md) ([ROADMAP.md](./ROADMAP.md) step 2).

## How to read

- Boxes are **mobile portrait**, ~36 columns.
- `[ Button ]` is a tap target. `( )` / `(x)` is a selected chip.
- Catalog art is **display only** (`image.source = tcgdex_assets`). It is never a listing photo the user took.
- Mock-scenario chips on today’s Home screen are **dev-only**. They do not appear here.

## UI template (HoloDex chrome, CardFlow product)

Borrow **structure** from HoloDex App Store screens. Do **not** copy HoloDex product promises.

| Borrow | Leave behind |
|--------|----------------|
| Dark navy canvas, rounded card tiles | Multi-TCG browse (Pokémon / One Piece / Lorcana / MTG / YGO) |
| Wordmark + USD + bell + avatar in the header | Live market sparkline as truth / “track profits” |
| 5-item bottom tab bar with a **raised center Scan** | AI grading score, PSA/BGS live rows |
| 2-column card grid, search, underlined segments | Scan cart of many cards (CardFlow is one still image at a time) |
| Full-screen camera: card-shaped frame, gallery left, shutter center | Paywall, Pro badges, unlimited-scan upsell |
| Confirm: “your picture” vs matching catalog thumbs | “Collect all” batch commit without Confirm |
| Detail: hero art + pill chips (set, #, EN, variant) | Community / trade / lucky-number gamification |

**Brand:** CardFlow gold accent (`#E8C547` in [apps/mobile/lib/theme.ts](../apps/mobile/lib/theme.ts)), not the HoloDex logo. Primary filled CTAs may use a bright blue like HoloDex “Collect” for scan/save; gold for wordmark and selected tab.

**Tab bar** (visible on Home, Collection, and placeholder tabs). Hidden on Capture, Confirm, Detail, Purchase, Draft, Max Buy rules.

ASCII below is the original validation sketch. **Shipped chrome** is in [WIREFRAME_TASKS.md](./WIREFRAME_TASKS.md): Collection is the default tab and holds Purchased | Watchlist; Home and Search are not tabs; Settings opens from the avatar; Capture starts from Collection; the raised center control is **Livestream Screener** and stays disabled.

```
 Home   Inventory   (O)   Watch   Settings
                 Scan
```

Center Scan in this sketch is a raised circle, same placement as HoloDex’s middle tab. Do not treat it as the shipped Scan entry.

## Copy rules (every screen)

- English raw Pokémon singles only.
- Human **Confirm** before any CRM write. Scan alone does not create inventory.
- Mint `cardflow_card_id` **on Confirm only**. Never key inventory, drafts, or URLs on CardSight or TCGdex alone.
- Pricing is an **estimate**. Max Buy is **guidance**. Asking vs all-in is **spread**, never “profit.”
- No Publish, no marketplace login, no scrape, no live video. Grading Prepare may show a photo estimate ([TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §4a) — not a cert.

## Navigation

```
Home / Inventory / Watch ──► Capture ──► Confirm ──► Detail
         │                                  │
         ├─ Settings                        ├─ Purchase ──► Inventory
         └─ Max Buy rules                   └─ Watchlist ──► Watch

Inventory (purchased tile) ──► Listing draft
```

---

## 1. Home / Inventory overview

**HoloDex pattern:** Header wordmark + USD + bell + avatar. Overview-style home (their Portfolio/Home), **without** a live market chart or total-value P&L. Empty state still uses the same chrome.

**Purpose:** Land, see recent Purchased / Watchlist copies, start a scan from the center tab.

**Primary actions:** Center Scan, open a tile, Settings (avatar), Max Buy rules.

### 1a. Empty

```
+------------------------------------+
| CardFlow          USD  (bell) (me) |
+------------------------------------+
| English raw singles                |
|                                    |
| Nothing saved yet.                 |
| Confirm a card, then Purchased or  |
| Watchlist. Scan does not create    |
| inventory.                         |
|                                    |
| Tap Scan to take a still photo.    |
|                                    |
+------------------------------------+
| Home  Inventory  (O)  Watch  More  |
+------------------------------------+
```

`More` / avatar opens Settings. Bell is reserved (no pricing-provider alerts in MVP).

### 1b. Populated

```
+------------------------------------+
| CardFlow          USD  (bell) (me) |
+------------------------------------+
| Recent                             |
| +----------+  +----------+         |
| | [art]    |  | [art]    |         |
| | Pikachu  |  | Charizard|         |
| | #58 EN   |  | #4 EN    |         |
| | purchased|  | watching |         |
| | all-in   |  | target   |         |
| | $4.04    |  | Max Buy  |         |
| +----------+  +----------+         |
|                                    |
| Purchased tiles open a draft.      |
| Watchlist tiles cannot draft.      |
+------------------------------------+
| Home  Inventory  (O)  Watch  More  |
+------------------------------------+
```

Two-column tiles match HoloDex collectables/wishlist grids (large art, name, meta under the card). If a purchased copy already has a draft, the tile shows **Draft** instead of prompting create.

### 1c. Load error

```
+------------------------------------+
| CardFlow          USD  (bell) (me) |
+------------------------------------+
| Could not load inventory.          |
| [ Try again ]                      |
+------------------------------------+
| Home  Inventory  (O)  Watch  More  |
+------------------------------------+
```

---

## 2. Scan / Capture

**HoloDex pattern:** Full-screen camera. Card-shaped rounded frame over a dimmed viewfinder. Top: close (X). Copy under the frame. Bottom toolbar: **gallery** (manual_scan) left, **large circular shutter** center, helper right. Tab bar hidden.

**Purpose:** Capture one still image (`camera_photo` or `manual_scan`). No live continuous identification.

**Primary actions:** Take photo, choose from library, Cancel.

### 2a. Camera photo

```
+------------------------------------+
| (X)                      (flashlight)|
+------------------------------------+
|                                    |
|      +----------------------+      |
|      |                      |      |
|      |    [ card frame ]    |      |
|      |    still image only  |      |
|      |                      |      |
|      +----------------------+      |
|                                    |
| Take a still photo of one English  |
| raw single to identify it.         |
|                                    |
|  [gallery]      ( O )      [help]  |
+------------------------------------+
```

`( O )` is the shutter (`camera_photo`). `[gallery]` is `manual_scan`. Not a streaming scanner — shutter commits one frame.

### 2b. Manual scan (library)

```
+------------------------------------+
| (X)  Choose a still photo          |
+------------------------------------+
| System photo picker                |
| One English raw single, full card. |
|                                    |
| [ Choose photo ]                   |
+------------------------------------+
```

### 2c. Camera permission denied

```
+------------------------------------+
| (X)  Capture                       |
+------------------------------------+
| Camera access is off.              |
| Enable it in system Settings, or   |
| pick a photo from the library.     |
|                                    |
| [ Open system Settings ]           |
| [ Choose photo ]                   |
+------------------------------------+
```

### 2d. User cancels

`(X)` returns to the tab they came from. No scan row to resume. Cancel must not mint `cardflow_card_id`.

---

## 3. Candidates / Confirm

**HoloDex pattern:** Review sheet after a shot — “your picture” vs **matching cards** thumbnail row, “Not quite right?”, then a filled primary CTA. CardFlow keeps **Confirm identity** (not “Collect this card”) and never batch-commits.

**Purpose:** Review CardSight candidates matched to TCGdex. High+High still requires Confirm (one tap) — never skip to inventory write.

**Primary actions:** Select candidate, Confirm identity, Reject / retry.

Until Confirm: `cardflow_card_id` is not minted. CRM write is blocked.

### 3a. High confidence (one candidate, Confirm still required)

```
+------------------------------------+
| (X)  Confirm card                  |
+------------------------------------+
| Your picture     Matching cards    |
| +--------+       +--------+        |
| | capture|       | catalog|        |
| +--------+       +--------+        |
|                                    |
| Pikachu                            |
| Pokemon  #58  EN  (normal)         |
| Base Set                           |
|                                    |
| Nothing is saved until Confirm.    |
| IDs stay separate.                 |
|                                    |
| [ Confirm identity ]               |
| [ Not this card ]                  |
+------------------------------------+
```

Filled blue primary (HoloDex “Collect this card” placement). Secondary ghost for reject.

### 3b. Ambiguous (picker)

```
+------------------------------------+
| (X)  Confirm card                  |
+------------------------------------+
| Ambiguous — pick the print.        |
|                                    |
| Your picture                       |
| +--------+                         |
| | capture|                         |
| +--------+                         |
|                                    |
| Matching cards                     |
| +------+ +------+ +------+         |
| |(x) #4| |() #4h| |() #4r|         |
| +------+ +------+ +------+         |
|                                    |
| Not quite right? Retake.           |
|                                    |
| [ Confirm identity ]               |
| [ None of these ]                  |
+------------------------------------+
```

### 3c. No card detected

```
+------------------------------------+
| (X)  Confirm card                  |
+------------------------------------+
| No card found                      |
| Fill the frame with one English    |
| single and take another still.     |
|                                    |
| [ Retake ]                         |
+------------------------------------+
```

No Confirm. No catalog picker. No CRM write.

### 3d. Timeout / provider error

```
+------------------------------------+
| (X)  Confirm card                  |
+------------------------------------+
| Recognition timed out              |
| Retryable. Nothing was confirmed.  |
|                                    |
| [ Retry ]                          |
+------------------------------------+
```

### 3e. Rate limit

```
+------------------------------------+
| (X)  Confirm card                  |
+------------------------------------+
| Too many scans                     |
| Wait and retry. CardFlow did not   |
| save this card.                    |
|                                    |
| Retry after ~30s                   |
| [ Retry ]                          |
+------------------------------------+
```

### 3f. No catalog match

```
+------------------------------------+
| (X)  Confirm card                  |
+------------------------------------+
| No catalog match                   |
| Recognition did not map to an      |
| English TCGdex single.             |
|                                    |
| No row to confirm.                 |
|                                    |
| [ Retake ]                         |
+------------------------------------+
```

Manual catalog search is **later**, not this MVP frame. HoloDex “Search manually” is noted as a later analog only.

### 3g. Reject / retry

```
+------------------------------------+
| (X)  Confirm card                  |
+------------------------------------+
| Not this card                      |
| Reject discards this scan. No      |
| cardflow_card_id. No inventory.    |
|                                    |
| [ Retake photo ]                   |
| [ Back ]                           |
+------------------------------------+
```

---

## 4. Card detail / Estimate

**HoloDex pattern:** Hero catalog art, name + number, pill chips (game · set · # · EN · variant). Scroll body for value. CardFlow replaces market/PSA blocks with **user-entered reference** and **Max Buy guidance**.

**Purpose:** Show confirmed catalog identity. Decide Purchased vs Watchlist.

**Primary actions:** Edit reference, Purchased, Watchlist, Edit Max Buy rules.

### 4a. With reference

```
+------------------------------------+
| <                          (share?)|
+------------------------------------+
|         +----------------+         |
|         |  [catalog art] |         |
|         +----------------+         |
| Pikachu #58                        |
| Pokemon  Base Set  #58  EN         |
| (normal)  Holofoil  Reverse        |
| Catalog art — not your listing pic |
|                                    |
| Reference (USD, you typed)         |
| [ 8.00                         ]   |
|                                    |
| +--------------------------------+ |
| | Max Buy                 $5.57  | |
| | 20% margin · 13% fees          | |
| | Guidance from your rules, not  | |
| | a market price or profit.      | |
| +--------------------------------+ |
|                                    |
| [ Purchased ]                      |
| [ Watchlist ]                      |
| [ Edit Max Buy rules ]             |
+------------------------------------+
```

No RAW / PSA 10 / PSA 9 price strip. No “your portfolio is gaining value” toast.

### 4b. Missing reference

```
+------------------------------------+
| <  Pikachu #58                     |
+------------------------------------+
|         +----------------+         |
|         |  [catalog art] |         |
|         +----------------+         |
| Pokemon  Base Set  #58  EN         |
|                                    |
| Reference (USD, you typed)         |
| [                              ]   |
| Enter a reference price to         |
| compute Max Buy.                   |
|                                    |
| You can still save Purchased or    |
| Watchlist. Max Buy stays empty     |
| until a reference exists.          |
|                                    |
| [ Purchased ]                      |
| [ Watchlist ]                      |
+------------------------------------+
```

Do not invent a pricing-provider module, live market chart, or “will sell for” line.

---

## 5. Purchase / Watchlist confirm

**HoloDex pattern:** Bottom sheet / follow-on form after the primary CTA (their “Collect this card” adds details). CardFlow uses a sheet over detail: cost lines for Purchased, reminder-only for Watchlist.

**Purpose:** Commit CRM intent. Purchased needs cost basis. Watchlist is interest only — not stock, no draft, no cost basis.

Required to save Purchased: `currency`, `purchase_price`, `purchased_at`. Optional lines default to `0`. All-in is independent of Max Buy.

### 5a. Purchased

```
+------------------------------------+
| Drag handle                        |
| Save purchased                     |
+------------------------------------+
| Pikachu · Base Set #58             |
| Max Buy $5.57 (guidance)           |
|                                    |
| Purchase price *      [ 3.50     ] |
| Purchased at          [ now      ] |
| Currency              USD          |
|                                    |
| Optional (default 0)               |
| Shipping              [ 0.00     ] |
| Tax                   [ 0.29     ] |
| Fees                  [ 0.00     ] |
| Supplies              [ 0.25     ] |
|                                    |
| All-in total               $4.04   |
|                                    |
| Condition             (NM) LP MP   |
| Variant               (normal)     |
|                                    |
| [ Save purchased ]                 |
+------------------------------------+
```

Purchase-price-only is enough. Do not block save on empty shipping/tax/fees/supplies.

### 5b. Watchlist

```
+------------------------------------+
| Drag handle                        |
| Save watchlist                     |
+------------------------------------+
| Charizard · Base Set #4            |
|                                    |
| Not owned. No cost basis.          |
| Cannot create a listing draft.     |
|                                    |
| Target Max Buy $5.57 (guidance)    |
| Reminder only — not a live feed    |
| or guaranteed price.               |
|                                    |
| Variant               (normal)     |
|                                    |
| [ Save to watchlist ]              |
+------------------------------------+
```

### 5c. Purchased validation error

```
+------------------------------------+
| Save purchased                     |
| Purchase price is required.        |
| Purchase price *      [          ] |
| [ Save purchased ]                 |
+------------------------------------+
```

On success: Inventory tab for Purchased (`acquired`), Watch tab for Watchlist (`watching`).

---

## 6. Inventory (purchased grid)

**HoloDex pattern:** 2-column “Your cards” grid with search. Segment **Purchased | Watchlist** like their Your cards | Wishlist. Large tiles; avoid a 2×2-only giant-icon trap — keep name + meta under art so more than four cards can scroll.

This is the **Inventory** tab. Home is the overview; this is the full list.

### 6a. Purchased populated

```
+------------------------------------+
| Inventory                 (search) |
| (Purchased)  Watchlist             |
+------------------------------------+
| +----------+  +----------+         |
| | [art]    |  | [art]    |         |
| | Pikachu  |  | ...      |         |
| | #58 NM   |  |          |         |
| | all-in   |  |          |         |
| | $4.04    |  |          |         |
| | [ Draft ]|  |          |         |
| +----------+  +----------+         |
+------------------------------------+
| Home  Inventory  (O)  Watch  More  |
+------------------------------------+
```

`[ Draft ]` = Create listing draft or Open listing draft. Watchlist segment on this tab is the same data as the Watch tab (either is fine; do not duplicate writes).

### 6b. Empty purchased

```
+------------------------------------+
| Inventory                          |
| (Purchased)  Watchlist             |
+------------------------------------+
| No purchased copies.               |
| Scan does not create inventory.    |
| Confirm, then Purchased.           |
+------------------------------------+
| Home  Inventory  (O)  Watch  More  |
+------------------------------------+
```

---

## 7. Watchlist tab

**HoloDex pattern:** Wishlist grid + search. No Collect-to-own. CardFlow: watching only.

```
+------------------------------------+
| Watchlist                 (search) |
+------------------------------------+
| +----------+  +----------+         |
| | [art]    |  |          |         |
| |Charizard |  |          |         |
| | #4 EN    |  |          |         |
| | watching |  |          |         |
| | target   |  |          |         |
| | Max Buy  |  |          |         |
| | cannot   |  |          |         |
| | draft    |  |          |         |
| +----------+  +----------+         |
+------------------------------------+
| Home  Inventory  (O)  Watch  More  |
+------------------------------------+
```

Empty: “Nothing watching. Confirm a card, then Watchlist.”

---

## 8. Max Buy / Preferences

**HoloDex pattern:** Settings-style stacked rows (their profile/performance list), not a market chart. Pushed from Settings or Detail.

**Purpose:** Edit CardFlow-owned rules. Later edits **recompute** guidance on old purchases from current prefs + stored reference.

Defaults: margin `0.20`, fees buffer `0.13`, condition factor `1.0` when unspecified, currency `USD`.

### 8a. Defaults

```
+------------------------------------+
| < Max Buy rules                    |
+------------------------------------+
| reference x (1 - margin)           |
|           x (1 - fees)             |
|           x condition factor       |
|                                    |
| Target margin         [ 20 ] %     |
| Fees buffer           [ 13 ] %     |
| Currency              USD          |
|                                    |
| Condition factor (optional)        |
| NM  [ 1.0 ]   (default if empty)   |
|                                    |
| Changing these updates Max Buy     |
| guidance on saved cards. It is     |
| not a market price.                |
|                                    |
| [ Save rules ]                     |
| [ Reset defaults ]                 |
+------------------------------------+
```

### 8b. Invalid input

```
+------------------------------------+
| < Max Buy rules                    |
+------------------------------------+
| Margin must be between 0 and 99.   |
| Target margin         [ 200 ] %    |
| [ Save rules ]                     |
+------------------------------------+
```

No bid-placement, auto-offer, or marketplace fee schedule.

---

## 9. Listing draft

**HoloDex pattern:** Pushed detail (tab bar hidden), hero art on top, form fields below. No share-to-market, no Publish.

**Purpose:** Internal reviewed document for a **Purchased** copy only. One active draft per copy.

`ready_for_review` needs `title`, `condition`, `asking_price`. AI copy is **OFF**. Copy on user tap only — never private `notes`.

### 9a. Editing

```
+------------------------------------+
| < Draft · internal                 |
+------------------------------------+
|         +----------------+         |
|         |  [catalog art] |         |
|         +----------------+         |
| Catalog art — not a listing photo  |
|                                    |
| Title                              |
| (Default)  Include condition       |
| [ Pikachu - Base Set #58           |
|   [normal] EN                    ] |
|                                    |
| Condition     (NM) LP MP HP DMG    |
| Asking price (USD)    [ 9.00     ] |
| Spread vs all-in           $4.96   |
| Spread / cost-to-ask — never       |
| labeled profit.                    |
|                                    |
| Description                        |
| [ Pikachu — Base Set #58 — EN    ] |
| Keyword chips: [Raw] [EN] [NM]     |
|                                    |
| Disclosure (optional)              |
| Corners   (sharp) light / soft     |
| Edges     (clean) whitening        |
| Surface   (clean) scratches        |
| Whitening (none)  corners          |
| Centering (looks good) off         |
| [ Add disclosure to description ]  |
|                                    |
| Channel note (in-app only)         |
| [ Maybe eBay later               ] |
| Private notes (never copied)       |
| [ Binder B2                      ] |
|                                    |
| [ Save draft ]                     |
| [ Ready for review ]               |
| [ Copy ]                           |
+------------------------------------+
```

There is **no** Publish button. `intended_channel_note` is free text, not a marketplace target.

### 9b. Missing ready fields

```
+------------------------------------+
| < Draft                            |
+------------------------------------+
| Ready for review still needs:      |
| condition, asking_price.           |
| Asking price (USD)    [          ] |
| [ Ready for review ]  (disabled)   |
| [ Save draft ]                     |
+------------------------------------+
```

### 9c. Ready for review + Copy

```
+------------------------------------+
| < Draft · ready for review         |
+------------------------------------+
| Ready for review. CardFlow did     |
| not publish this.                  |
|                                    |
| Copied title, description,         |
| condition, and asking price.       |
| Private notes omitted.             |
|                                    |
| [ Copy again ]                     |
+------------------------------------+
```

Clipboard disclaimer: CardFlow clipboard export only. CardFlow did not publish this listing to any marketplace.

### 9d. Watchlist attempted (should not open)

```
+------------------------------------+
| < Draft                            |
+------------------------------------+
| Watchlist cannot draft.            |
| Save as Purchased first.           |
| [ Back to inventory ]              |
+------------------------------------+
```

---

## 10. Settings

**HoloDex pattern:** Gear + avatar header, stacked stat/info cards, then rows. CardFlow: no total-market-value hero, no Pro badge, no graded count.

**Purpose:** About, non-affiliation, research flags (off), link to Max Buy preferences. No paid subscription in private beta.

### 10a. Main

```
+------------------------------------+
| (gear) CardFlow     USD  (bell)(me)|
+------------------------------------+
| Private beta · invited user        |
|                                    |
| [ Max Buy rules ]                  |
|                                    |
| Research (off)                     |
| Live identification          OFF   |
| In-app marketplace browser   OFF   |
| Auto-scan                    OFF   |
| Pricing provider             OFF   |
| Marketplace automation       OFF   |
|                                    |
| [ About CardFlow ]                 |
+------------------------------------+
| Home  Inventory  (O)  Watch  More  |
+------------------------------------+
```

Research toggles are **visible as off**. Do not offer an in-app path to turn marketplace automation on. Do not clone HoloDex subscription / AI Grading rows.

### 10b. About

```
+------------------------------------+
| < About                            |
+------------------------------------+
| CardFlow is not affiliated with,   |
| endorsed by, or sponsored by       |
| Nintendo, The Pokémon Company,     |
| or Game Freak.                     |
|                                    |
| Recognition is a provider.         |
| Catalog metadata is TCGdex.        |
| CardFlow owns inventory and        |
| drafts. No marketplace publish.    |
|                                    |
| Catalog images: TCGdex assets      |
| (display only).                    |
|                                    |
| Layout inspired by collector-app   |
| chrome (HoloDex); CardFlow is a    |
| separate product.                  |
+------------------------------------+
```

Final About legal copy is a founder/legal review item. This frame only reserves the non-affiliation placement.

### 10c. Unauthenticated (later auth)

Auth model is still a validation item. Until then, Settings may omit account switching. Do not invent Apple/Google buttons or a HoloDex-style mandatory sign-up wall in this pass.

---

## Dev-only (not product)

Today’s Home mock-scenario chips (High / Ambiguous / No card / Timeout / Rate limit / No match) stay in the scaffold until live capture exists. They must not appear on product Home after route split.

```
+------------------------------------+
| DEV  Mock scenario                 |
| (High) Ambiguous  No card          |
| Timeout  Rate limit  No match      |
+------------------------------------+
```

---

## Out of scope (do not frame)

- Publish / eBay / Whatnot / TCGplayer / Shopify listing forms
- Live camera streaming ID (HoloDex “point and scan” continuous feel is **not** CardFlow MVP)
- Sold / shipped / paid out warehouse screens
- Pricing-provider market charts, PSA strips, or profit/returns
- Auto-grade as an official cert / CardFlow-as-grader (Prepare photo **estimate** is [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §4a; PokeTrace slabs later)
- Multi-TCG set browser
- Paywall, Pro, CSV export (clipboard-only for beta)

See [NON_GOALS.md](./NON_GOALS.md) and [CRM_WORKFLOW_STATES.md](./CRM_WORKFLOW_STATES.md).
