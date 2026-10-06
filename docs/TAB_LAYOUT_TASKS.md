# Tab layout tasks

Do these **in order**. One task at a time. Check the box when the “Done when” line is true.

**Follow:** [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) for layout, copy, and borrow/leave.  
**Rules:** [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md) — do not rewrite it.  
**Chrome:** existing header + tab bar in [WIREFRAME_TASKS.md](./WIREFRAME_TASKS.md).

Stay on the mock API. Do not add Publish, AI grading, live prices, profit labels, live PSA, or real camera until a later task says so.

Priority (all pages): **Collection → Export → Shop → Grading → Livestream**. Collection is the landing tab and already holds the scan loop; Export and Shop are honest routing; Grading is the largest new CRM surface; Livestream is last because it is an in-app browser + overlay and must not grow identify/bid/scrape.

```sh
pnpm test
pnpm typecheck
# After any task that can affect the loop:
# scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy
```

---

## Before you start

- [x] Read [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) end to end (shared chrome + all five pages).
- [x] Skim [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md) (Confirm, inventory grain, drafts, Max Buy, no publish).
- [x] Confirm tab bar is still `Collection (O) Shop Grading Export`, Collection default, Home/Search gone.

**Done when:** You know which controls must not look tappable if they cannot complete the job.

---

## Phase 1 — Collection (landing)

Already built: scan strip, title + search, Purchased | Watchlist, 2-column grid, empty/error, purchased → draft, watchlist → detail. These tasks only close the plan gaps. Do not restyle.

### Task 1 — Collection audit (no new chrome)

- [x] Done.

Touch: [apps/mobile/app/(tabs)/collection.tsx](../apps/mobile/app/(tabs)/collection.tsx).

- Scan strip still opens Capture (still photo). Center tab is not a second Scan.
- Search filters the **current** segment only.
- Purchased tile → create/open draft. Watchlist tile → detail, not draft.
- Empty purchased / empty watchlist / load-error copy still match the plan.

**Done when:** The loop still works. No portfolio $ hero, sparkline, or profit copy.

**Do not:** Restyle tiles. Add a Scan control to the tab bar.

### Task 2 — Counts row

- [x] Done.

Follow: [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §1 zone 2.

- Under the scan strip, text only: `N purchased` · `M watching`.
- Counts come from inventory (all items, not the active search query).
- No currency, no all-in sum, no “value.”

**Done when:** Empty collection shows `0 purchased · 0 watching`. Saving Purchased or Watchlist updates the numbers after return.

---

## Phase 2 — Export

Fastest honest tab. Clipboard only. Watchlist never appears here.

### Task 3 — Export destination list (layout)

- [x] Done.

Follow: [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §5.

Touch: [apps/mobile/app/(tabs)/export.tsx](../apps/mobile/app/(tabs)/export.tsx). Replace the placeholder/wireframe grid.

- Title `Export`.
- Constraint: `Clipboard copy omits private notes. CardFlow did not publish this.`
- Three rows: Copy listing · CSV (`not in private beta`) · Publish (`no`).
- CSV and Publish are not tappable (or tap shows the same disabled meta, no navigation).

**Done when:** The tab matches the Export ASCII. No CSV file, no Publish control.

### Task 4 — Copy listing routing

- [x] Done.

- If any **purchased** draft exists, Copy listing opens that draft (prefer `ready_for_review`, else the most recent purchased draft).
- If none, Copy listing opens Collection, Purchased segment.
- Watchlist items never qualify.

**Done when:** Purchased → draft → Export → Copy listing returns to the draft. Watchlist-only inventory does not open a draft.

### Task 5 — Ready to copy rows

- [x] Done.

- Below the destination list, section `Ready to copy` only when purchased drafts exist.
- One row per purchased draft: title (or card name), `draft` vs `ready_for_review`.
- Tap → existing draft screen. Copy on that screen still omits notes.

**Done when:** Two purchased drafts both appear. Watchlist copies do not. Empty: section omitted, not a fake row.

---

## Phase 3 — Shop

Honest routing. No fake catalog.

### Task 6 — Shop job rows (layout)

- [x] Done.

Follow: [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §3.

Touch: [apps/mobile/app/(tabs)/shop.tsx](../apps/mobile/app/(tabs)/shop.tsx).

- Title `Shop`.
- Constraint: `CardFlow does not open a marketplace or publish listings.`
- Three rows: Buy / Sell / Supplies. Supplies disabled, meta `Later`.
- No product grid, cart, prices, or seller names.

**Done when:** The tab matches the Shop ASCII.

**Do not:** Collectr-style listing grid. Checkout. Scraped markets.

### Task 7 — Shop Buy and Sell taps

- [x] Done.

- Buy → Capture (`/capture`). Copy: confirm, then Purchased.
- Sell → same routing as Export Copy listing (purchased draft if any, else Collection Purchased).
- Supplies stays disabled.

**Done when:** Buy starts the still-photo loop. Sell never opens watchlist or a marketplace.

---

## Phase 4 — Grading

Largest surface. Layout + **local / in-memory user fields** first. No PSA client. Watchlist cannot enter.

### Task 8 — Grading chrome + segments

- [x] Done.

Follow: [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §4.

Touch: [apps/mobile/app/(tabs)/grading.tsx](../apps/mobile/app/(tabs)/grading.tsx).

- Title `Grading`. Constraint: `CardFlow does not auto-grade.`
- Underlined segments `Prepare | Submitted | Returned` (same pattern as Collection).
- Each segment has an empty state from the plan (Prepare can wait until Task 9 for the purchased list).

**Done when:** Switching segments does not leave the tab. No 1–10 score, no “Gem Mint.”

### Task 9 — Prepare list (purchased only)

- [x] Done.

- Prepare shows purchased inventory rows: art thumb, name, `#`, all-in, condition if any.
- Search filters this list.
- Watchlist copies do not appear.
- Empty: `No purchased copies.` plus scan-does-not-create-inventory reminder.
- Row CTA label `Prepare` (sheet comes in Task 10).

**Done when:** A purchased save appears here. A watchlist-only save does not.

### Task 10 — Prepare sheet chrome

- [x] Done.

- Tap Prepare on a purchased row opens a sheet (or push) over Grading.
- Hero: catalog art, display only.
- Front / back photo slots as placeholders. User can skip. No `expo-camera` live identify.

**Done when:** Closing the sheet does not mint IDs or write inventory. Watchlist cannot open it.

### Task 11 — Prepare checklist + condition

- [x] Done.

Follow: four pillars in [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §4a.

- Centering / Corners / Edges / Surface with the plan’s answers (user taps, not AI).
- Condition chips: NM LP MP HP DMG.
- Reuse listing-draft disclosure language where it already exists. Do not invent a grade table.

**Done when:** User can select pillars and condition. Nothing is labeled a PSA score.

### Task 12 — Prepare guidance + Move to Submitted

- [x] Done.

- Guidance block: `Max Buy $X (your rules). Grading fees are separate. This is not a PSA score.`
- Optional service-level note (free text, e.g. `PSA Regular`). Not a fee schedule.
- `[ Move to Submitted ]` only for that purchased copy. Then the row leaves Prepare and appears on Submitted (Task 13).
- Local / in-memory is enough. Do not add a PSA HTTP client.

**Done when:** Move to Submitted is blocked for watchlist. Max Buy is guidance, never profit.

### Task 13 — Submitted list + status

- [x] Done.

Follow: [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §4b.

- Rows: art, name, user order # (typed), company text, status chip `Sent` or `At grader`.
- Tap row to edit order # / company / status.
- Empty: `Nothing submitted. Prepare a purchased copy first.`

**Done when:** A prepared copy shows here. Status changes stay on the device (or mock store). No live order tracking.

### Task 14 — Returned list

- [x] Done.

Follow: [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §4c.

- From Submitted, user can mark returned.
- Rows: art, name, user-typed cert #, returned condition/grade **typed by the user**.
- Empty: `Nothing returned.`

**Done when:** Cert # is a field the user owns. No cert lookup network call. No PDF/QR certificate.

---

## Phase 5 — Livestream Screener (last)

**Layout for this file is done.** Later identify work is [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) Phase 6 and [ROADMAP.md](./ROADMAP.md): **in-stream live video** (YOLO + card-identity), **not** screenshot / “Scan a still photo.” Do not add Capture as the livestream identify path.

In-app browser + CardFlow overlay. Follow [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) §2 for chrome. Must not scrape or bid.

Touch: [apps/mobile/app/(tabs)/scan-tab.tsx](../apps/mobile/app/(tabs)/scan-tab.tsx). Center tab **opens this screen** (it is the screener, not Capture). Tab bar hidden while a show is open; `(X)` → Collection.

### Task 15 — Browser chrome

- [x] Done.

- Top bar like the reference screenshot: `(X)`, site badge, URL label, `[ON]`.
- No free-form address bar. URL is a label for the selected platform.
- `(X)` returns to Collection. Does not mint `cardflow_card_id`.

**Done when:** The bar matches §2a chrome. Closing never writes inventory.

### Task 16 — Whatnot | eBay switch

- [x] Done.

- Under the URL bar: underlined segments `(Whatnot) eBay`. Default **Whatnot**.
- Switching updates the site badge + URL label (`www.whatnot.com` vs `www.ebay.com/ebaylive`).
- No third marketplace.

**Done when:** Toggling Whatnot ↔ eBay is visible in chrome only. No scrape of lots into CRM.

### Task 17 — Screener overlay strip

- [x] Done.

- Band under the chrome (Brickify position): catalog thumb, name, stacked **Reference** (you typed) and **Max Buy** (guidance).
- Caption: `CardFlow overlay · not a market`.
- Do **not** add PSA 9 / PSA 10 (or Raw live) figures.
- Empty overlay copy from §2c until a card is confirmed. `[ Scan a still photo ]` → Capture.

**Done when:** Overlay layout matches the screenshot’s identity strip spatially, with CardFlow fields only.

### Task 18 — WebView live region

- [x] Done.

- Remaining body is one region: `WebView: Whatnot live page` or `WebView: eBay live page`.
- Chat, listing, Custom/Bid, timers stay **inside** that page. CardFlow does not draw bid buttons.
- Layout pass may use a labeled placeholder box. Loading a real WebView is allowed only as navigation to that platform’s live URL — no DOM scrape, no bid injection.

**Done when:** The live page fills below the overlay. CardFlow has no Custom/Bid bar of its own.

### Task 19 — Errors + hard no’s

- [x] Done.

- Load failure uses §2d (`Try again` / `Open Collection`).
- Shutter/identify is not on this tab. `POST /v1/scans` only from Capture.
- Overlay never auto-fills identity from video.

**Done when:** Failed load is recoverable. Confirm is still required before inventory. No auto-bid, no login automation.

**Do not:** Continuous CardSight ID. Brickify-style live PSA comps. Scraping. Marketplace automation.

---

## Stop here

Do **not** start after this list until the five tabs match [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md):

| Later | Why not now |
|-------|-------------|
| Real camera / library still hitting mock identify | [ROADMAP.md](./ROADMAP.md) step 3 — [STILL_IMAGE_CAPTURE_TASKS.md](./STILL_IMAGE_CAPTURE_TASKS.md) |
| Durable grading submissions on the API | Fine after Tasks 12–14 if still local |
| Real WebView + overlay wired to a confirmed card | Superseded: overlay identity comes from live video, not Confirm-from-Capture |
| Live CardSight / official PSA cert API | Never as Capture identify. Prepare slab comps are PokeTrace ([GRADING_PREPARE_TASKS.md](./GRADING_PREPARE_TASKS.md)). Never a live PSA account |
| CSV, publish, auto-bid, scrape | Do not build |
| Official cert / CardFlow-as-grader / casecomp or tcg-oracle source | Photo estimate + PokeTrace only — [GRADING_PREPARE_TASKS.md](./GRADING_PREPARE_TASKS.md) |
| Screenshot / still of the livestream as identify | [ROADMAP.md](./ROADMAP.md) — forbidden |
| In-stream YOLO + card-identity + PokéCollector prices | [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) Phase 6 |

---

## Definition of done (this file)

- [x] Collection shows purchased/watching counts with no money total. Scan strip is the only scan entry from this tab.
- [x] Export lists Copy / CSV / Publish honestly. Only purchased drafts are copyable. Notes still omitted.
- [x] Shop is three job rows. Buy → Capture. Sell → draft or Collection Purchased. No catalog grid.
- [x] Grading has Prepare / Submitted / Returned. Purchased only. User-typed order/cert. Photo estimate is [GRADING_PREPARE_TASKS.md](./GRADING_PREPARE_TASKS.md), not this file.
- [x] Livestream **layout** is an in-app Whatnot | eBay browser with a CardFlow overlay strip. Live identify from video is **not** in this file (see [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) Phase 6). No PSA comps, no CardFlow bid bar.
- [x] `pnpm test` and `pnpm typecheck` pass.
- [x] Scan → confirm → Purchased or Watchlist → draft → Copy still works.
