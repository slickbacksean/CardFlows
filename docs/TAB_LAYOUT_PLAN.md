# Tab layout plan (Collection, Livestream, Shop, Grading, Export)

**Status:** Layout plan. Collection / Livestream / Shop / Export chrome is in the app. **Grading Prepare** is a photo **estimate** — see [GRADING_PREPARE_TASKS.md](./GRADING_PREPARE_TASKS.md). [PokeTrace](https://poketrace.com/) slab comps are **later**. No coloration pass. No publish.  
**Build order:** Tab chrome: [TAB_LAYOUT_TASKS.md](./TAB_LAYOUT_TASKS.md) (done). Prepare estimate: [GRADING_PREPARE_TASKS.md](./GRADING_PREPARE_TASKS.md).  
**Constraints:** [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md), [NON_GOALS.md](./NON_GOALS.md). Founder exceptions in [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) and [ROADMAP.md](./ROADMAP.md) beat older “no auto-grade / no PSA strip” lines **for this tab only**. Do not rewrite the brief.  
**Chrome:** [WIREFRAMES.md](./WIREFRAMES.md) + current tab bar in [WIREFRAME_TASKS.md](./WIREFRAME_TASKS.md).

```
 Collection   (O)   Shop   Grading   Export
           Livestream Screener
```

Collection is the default tab. Capture is still a still photo from Collection. Center Livestream is a disabled layout, not a scanner.

Reference apps are **structure and job-to-be-done only**. CardFlow does not copy their product promises.

| App | Borrow | Leave behind |
|-----|--------|----------------|
| **HoloDex** | Header (wordmark + USD + bell + avatar). 2-column tiles with name + meta under art. Underlined **Purchased \| Watchlist**. Full-screen still capture: card frame, gallery left, shutter center. Confirm: your picture vs matching thumbs. Detail: hero + pills. | Live continuous ID. Scan cart / batch collect. Multi-TCG. AI grade score. Live market as truth. Profit / P&L. Paywall. |
| **Collectr** | Collection as the home. Search-in-collection. Scan/add from the collection surface. Cost basis on owned copies. Clear empty states with one primary add action. | Live portfolio value / Performance tab. Profit & loss. Marketplace buy/sell. Social feed. Multi-portfolio / multi-TCG. Graded vs raw price charts as truth. CSV as a paid export. Instant add without Confirm. |
| **TCG Grading** | Four inspection pillars (centering, corners, edges, surface) as a **layout**. Front + back photo slots. “Is this worth sending?” as the Prepare job. | PDF certificates / QR certs. Leaderboards and streaks. Multi-TCG. CardFlow-as-grader / official cert. |
| **[casecomp](https://github.com/Pyronewbic/casecomp)** | **Pipeline only** for the photo estimate: detect the card, straighten, crop corners, eight subgrades (centering / corners / edges / surface × front / back), weighted overall. Static typical fee table as a label, not a live schedule. | Do **not** copy source. No magi / Yahoo / SNKRDUNK scrape. No eBay HTML. No drop-queue extension. No Commons Clause code in `apps/` or `packages/`. No `api.casecomp.xyz`. |
| **[PokeTrace](https://poketrace.com/)** | **Later.** Licensed slab market **estimates** (PSA / BGS / CGC / TAG) for Prepare. USD. Fail soft. Server-only key. Shared DTO lives in `packages/shared/src/slab-pricing.ts`. | Not in the app now. Raw TCGPlayer/Cardmarket (PokéCollector already owns that). Listing drafts. Overlay. “This is what it will sell for.” |
| **PSA** | Submission as a **pipeline** (prepare → sent → at grader → returned). User-typed order / cert fields. Status the user sets. Cert number as an identifier they own. | Live PSA account, order API, or pop report. Grade-reveal animation. eBay consign / vault. Scan-label verification as a live network call. Official grader branding as if CardFlow were PSA. |

UX rule for every tab: one primary job, one primary action, honest empty state. Do not draw a control that looks tappable if it cannot complete the job.

---

## Shared chrome (all tabs)

**HoloDex:** keep the existing app header on tabs.

```
+------------------------------------+
| CardFlow          USD  (bell) (me) |
+------------------------------------+
|           [ tab body ]             |
+------------------------------------+
| Collection  (O)  Shop  Grade Export|
+------------------------------------+
```

- Bell stays a no-op (no pricing alerts).
- Avatar → Settings → Max Buy rules / About.
- Tab bar hidden on Capture, Confirm, Detail, sheets, Draft, Max Buy, Settings, About.

---

## 1. Collection (default landing)

**Job:** Land, see owned + watching copies, start a still scan, open a draft (purchased) or detail (watchlist).

**Primary action:** Scan a card (still photo).

**References:** Collectr Portfolio as home + HoloDex Your cards / Wishlist grid.

### Layout (top → bottom)

1. **Scan strip** (full width). Camera glyph + “Scan a card” + “Still photo of one English raw single.” Tap → Capture. This replaces HoloDex’s working center Scan and Collectr’s scan-to-add, without livestream.
2. **Counts row** (text only, no money). `N purchased` · `M watching`. Not a portfolio total. Collectr’s Performance numbers stay out.
3. **Title + search.** “Collection” left, search field right (already in the app). Search filters the current segment only.
4. **Segments.** Underlined `Purchased | Watchlist` (HoloDex). Watchlist is the Collectr-style want list, but it is not stock and cannot draft.
5. **2-column grid.** Catalog art, name, `#` + EN, purchased vs watching, all-in or target Max Buy. Purchased with a draft shows **Draft**. Watchlist shows **cannot draft**.
6. **Empty / error.** Keep current copy. Empty purchased: scan does not create inventory. Empty watchlist: confirm, then Watchlist. Load error: Try again.

```
+------------------------------------+
| CardFlow          USD  (bell) (me) |
+------------------------------------+
| [Scan a card]                   >  |
| Still photo · one English raw      |
| 12 purchased · 3 watching          |
| Collection              [ search ] |
| (Purchased)  Watchlist             |
| +----------+  +----------+         |
| | [art]    |  | [art]    |         |
| | Pikachu  |  |Charizard |         |
| | #58 EN   |  | #4 EN    |         |
| | all-in $ |  | watching |         |
| | Draft    |  | cannot   |         |
+------------------------------------+
```

**Taps:** Purchased tile → create/open draft. Watchlist tile → detail (no draft). Scan strip → Capture.

**Do not:** Portfolio $ hero, sparkline, “gaining value,” PSA 10 strip, second Scan control in the tab bar.

---

## 2. Livestream Screener (in-app browser)

**Layout status:** chrome in this section was the screenshot-era strip. **Identify rules:** [ROADMAP.md](./ROADMAP.md) — live video, YOLO + card-identity, PokéCollector estimates. Do not identify from a screenshot or Capture still.

**Job:** Watch a **Whatnot** or **eBay** live show inside CardFlow. Scanner ON identifies the exact card from the **live video** and overlays CardFlow guidance (estimate + Max Buy). Not to bid, not to scrape.

**Primary action:** Turn the scanner on (and switch Whatnot | eBay). X closes to Collection. Capture is **not** an entry from this tab.

**References:**
- **Screenshot (Whatnot + Brickify overlay):** in-app browser bar, identity strip over the live video (thumb + name + stacked figures on the right), live page underneath (video, chat, listing, bid).
- **HoloDex:** do **not** copy live camera identify.
- **Collectr / PSA price strips:** do **not** fill PSA 9 / PSA 10 as live market truth.

**Layers (back → front)**

| Layer | Owner | What it is |
|-------|--------|------------|
| 1. Embedded live page | Whatnot or eBay (WebView) | Video, chat, giveaway, listing title, bid/timer — **their** UI. CardFlow does not rebuild it. |
| 2. Screener strip | CardFlow | Brickify-style band **under the browser bar**: catalog thumb, name, two stacked CardFlow figures. |
| 3. Browser chrome | CardFlow | Close, back/forward, URL, live ON, **Whatnot \| eBay** switch. |

CardFlow tab bar is **hidden** while a show is open (same as Capture). `(X)` → Collection.

### 2a. Whatnot (default)

Matches the screenshot’s **structure**, not Brickify’s PSA comps.

```
+------------------------------------+
| (X) (W) www.whatnot.com      [ON]  |
| (Whatnot)  eBay                    |
+------------------------------------+
| [art]  Turtwig                     |
|        Reference     Max Buy       |
|        $8.00         $5.57         |
|        you typed     guidance      |
| CardFlow overlay · not a market    |
+------------------------------------+
|                                    |
|   [ WebView: Whatnot live page ]   |
|   video · chat · listing · bid     |
|                                    |
+------------------------------------+
```

Spatial mapping from the screenshot:

| Screenshot | CardFlow slot |
|------------|----------------|
| In-app browser (X, site icon, URL, ON) | Same. Site icon follows the switch (W or eBay). |
| Brickify thumb + name | Catalog thumb + confirmed name (empty until Confirm). |
| Raw $ live | **Reference (you typed)** or `Enter a reference`. |
| PSA 9 / PSA 10 live | **One stacked pair only:** Max Buy (guidance). Do **not** add PSA 9 / PSA 10 comps. Pricing provider stays OFF. |
| Giveaway, chat, “Say something”, listing, Custom / Bid | Stay **inside the WebView**. CardFlow does not draw bid buttons and does not place bids. |

### 2b. eBay live

Same CardFlow chrome and overlay. Only the WebView URL / site badge change.

```
+------------------------------------+
| (X) (e) www.ebay.com/ebaylive [ON] |
|  Whatnot  (eBay)                   |
+------------------------------------+
| [art]  … same overlay as 2a …      |
+------------------------------------+
|   [ WebView: eBay live page ]      |
+------------------------------------+
```

Switch is two underlined segments in the browser bar (`Whatnot | eBay`), not a third marketplace.

### 2c. Overlay empty (scanner off or no card yet)

Video may still play. Overlay does not invent an identity and does **not** send the user to Capture.

```
+------------------------------------+
| (X) (W) www.whatnot.com      [ON]  |
| (Whatnot)  eBay                    |
+------------------------------------+
| [  ]  Scanner off                  |
|       or looking for a card…       |
+------------------------------------+
|   [ live video: Whatnot / eBay ]   |
+------------------------------------+
```

Do **not** use “Scan a still photo” or “Overlay is not live ID.” Overlay chrome is back/forward + page ON vs scanner ON ([VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) Task 26).

### 2d. Browser error

```
+------------------------------------+
| (X)  Livestream Screener           |
| Could not load the live page.      |
| [ Try again ]  [ Open Collection ] |
+------------------------------------+
```

### Behavior

- Default platform: **Whatnot** (matches the reference screenshot).
- Switch reloads the WebView to that platform’s live entry URL. It does not scrape listings into CRM.
- URL bar is display + platform switch, not a free-form address bar for arbitrary sites.
- `ON` in the URL bar means the embedded live page is loaded. Scanner ON (separate control) means in-stream YOLO + identity is running — not a screenshot, not CardSight.
- Overlay never writes inventory. Watchlist / Purchased still happen after Confirm on Detail.

**Do not:** Live video identification. Brickify/PSA 9/10 (or any live comps) as truth. Auto-bid, bid interception, or CardFlow-drawn Custom/Bid bars. Scraping chat or lot titles into inventory. Login/session automation. A third marketplace. Recreating Whatnot/eBay chat or checkout in CardFlow UI.

---

## 3. Shop

**Job:** Be honest that CardFlow is not a marketplace, then route the actual jobs (buy → scan, sell → draft copy).

**Primary action:** `Open Collection` (or `Copy a listing draft` if any purchased drafts exist).

**References:** Collectr Marketplace *information architecture* (search, categories, product grid) is what users expect — and what we must **not** fake as a store. Better UX: three destination rows, not a tappable product grid with nowhere to check out.

### Layout

1. Title: `Shop`.
2. One-line constraint: `CardFlow does not open a marketplace or publish listings.`
3. **Three job rows** (list, not grid):

| Row | Label | Meta | Tap |
|-----|--------|------|-----|
| Buy | Scan a still photo | Confirm, then Purchased | Capture |
| Sell | Copy a listing draft | Purchased only · notes omitted | Collection, purchased, or first ready draft |
| Supplies | Card sleeves, toploaders | Later | Disabled row |

4. Empty/disabled footer: no cart, no prices, no seller names.

```
+------------------------------------+
| Shop                               |
| Not a marketplace. No publish.     |
|------------------------------------|
| Buy     Scan a still photo      >  |
| Sell    Copy a listing draft    >  |
| Supplies  Later                    |
+------------------------------------+
```

**Do not:** Product grid that looks like Collectr shop. Live listings. Checkout. Scraped eBay/TCGplayer. “For sale” on watchlist.

---

## 4. Grading

**Job:** Help a flipper **decide whether to send** a purchased raw copy (rough grade if submitted), then **log** a mail-in they already did. CardFlow is not a grading company.

**Primary action:** `Prepare a submission` (from purchased copies only).

**References:**
- **TCG Grading:** four pillars as a layout (centering / corners / edges / surface), front + back slots.
- **casecomp (pipeline only):** card detect → tilt correct → corner crops → eight subgrades → weighted overall. Reimplement behind a server port. Do not vendor the repo.
- **[PokeTrace](https://poketrace.com/) — later:** PSA / BGS / CGC / TAG slab estimates. Not on Prepare in this pass. [Graded prices](https://poketrace.com/docs/graded-prices).
- **PSA:** pipeline of statuses the user advances: Prepare → Sent → At grader → Returned. Order # and cert # are typed. No PSA login.

### Segments

`Prepare | Submitted | Returned` (underlined, same pattern as Collection).

### 4a. Prepare

Pick a **purchased** copy (search + 1-column rows: art thumb, name, `#`, all-in). Tap opens a prepare sheet:

1. Hero catalog art (display only — never the user still).
2. Front / back photo slots. **Required for a photo estimate.** User may still Move to Submitted without photos (no estimate). Prefer the Capture still for front when `image_storage_ref` exists; back is a second still. No livestream screenshot. No `expo-camera` live identify.
3. **Photo estimate** (server `CardGradingProvider`). Rough grade if this copy is submitted — not a cert:
   - Overall (one decimal, e.g. `8` / `8.5`) plus confidence (High / Medium / Low).
   - Eight subgrades: centering / corners / edges / surface × front / back. When L/R (and optional T/B) ratios are measured, centering is scored from a CardFlow-owned PSA-style table (`55/45` → 10). Unmeasured stays null — never invent an 8. Corners / edges / surface may be capped from defect counts later; mock uses a fixture.
   - Overall formula (casecomp approach, CardFlow-owned math): `(frontAvg × 0.60) + (backAvg × 0.40)`, capped at `lowestSubgrade + 1`. Round `<0.25` down, `0.25–0.74` to `.5`, `≥0.75` up. Missing back → front-only, confidence capped at Medium.
   - Flag off / no photos / model fail: `No photo estimate yet.` plus Search-not-applicable. Do not invent a score.
   - User may **override** the four pillars with the listing-disclosure chips. Override does not rewrite the model scores; it is the user's self-assess for disclosure.
4. User condition chips: NM LP MP HP DMG. These stay **user-owned** listing/inventory condition. The photo estimate must **not** auto-fill `condition` or listing title.
5. Guidance block: `Max Buy $X (your rules). Photo estimate is not a cert. Typical grading fees are separate.` Optional typical-fee line from the static table (PSA Regular $50, etc.) — labeled **typical, not live**.
6. Optional note: service level as free text (`PSA Regular`, `CGC`, etc.).
7. `[ Move to Submitted ]` requires a purchased copy. Watchlist cannot enter this flow. Moving does not mint a cert and does not write the estimate as inventory condition.

**Later (not this pass):** Graded market rows via [PokeTrace](https://poketrace.com/) — PSA 8 / 9 / 10, BGS 9.5, CGC 10, TAG 10. Keep the shared slab DTO. Do not scrape. Do not show these rows until that later task.

```
Centering   (looks good) slightly off / off
Corners     (sharp) light / soft
Edges       (clean) whitening
Surface     (clean) scratches
```

### 4b. Submitted

List rows: art, name, user order #, company text, status chip (`Sent` / `At grader`). Tap to edit status. Empty: `Nothing submitted. Prepare a purchased copy first.`

The photo estimate stays on the copy as **guidance history** if already computed; it is not an official grade.

### 4c. Returned

List rows: art, name, user-typed cert #, returned condition/grade **typed by the user**. Empty: `Nothing returned.`

The returned grade the user types is the **actual** cert result. Do not overwrite it with the photo estimate.

```
+------------------------------------+
| Grading                            |
| (Prepare)  Submitted  Returned     |
| Photo estimate, not a cert.        |
|------------------------------------|
| +----+  Pikachu #58  all-in $4.04  |
| |art |  NM · purchased             |
| +----+  [ Prepare ]                |
+------------------------------------+
```

**Do not:** “Gem Mint” as CardFlow output. PDF/QR certificates. Leaderboards. Live PSA pop / cert verify. Watchlist submissions. eBay consign. Copy [casecomp](https://github.com/Pyronewbic/casecomp) or [tcg-oracle-app](https://github.com/sailorpepe/tcg-oracle-app) source. Put an Anthropic key on the device. Write the estimate onto listing drafts. Claim profit. Ship PokeTrace slab rows in this pass.

---

## 5. Export

**Job:** Get listing text out of CardFlow. Clipboard only for private beta.

**Primary action:** Open a purchased draft that can Copy.

**References:** Collectr’s export/sold-listings *placement* (a dedicated surface for getting data out). Leave CSV, analytics dump, and marketplace publish.

### Layout

1. Title: `Export`.
2. Constraint: `Clipboard copy omits private notes. CardFlow did not publish this.`
3. **Destination list:**

| Row | State | Tap |
|-----|--------|-----|
| Copy listing | Enabled if any purchased draft exists | That draft (or Collection purchased) |
| CSV | Disabled | `Not in private beta` |
| Publish to marketplace | Disabled | `No` |

4. **Ready to copy** section (only if drafts exist): 1-column rows of purchased drafts (`title`, `ready_for_review` vs `draft`). Tap → existing draft screen. Copy still omits notes.

```
+------------------------------------+
| Export                             |
| Clipboard only. Notes omitted.     |
|------------------------------------|
| Copy listing     on listing draft >|
| CSV              not in private beta|
| Publish          no                |
|------------------------------------|
| Ready to copy                      |
| Pikachu - Base Set #58  [ready]  > |
+------------------------------------+
```

**Do not:** CSV download. Publish. Auto-copy on save. Watchlist in this list.

---

## Cross-tab UX (how the four apps map to CardFlow)

| User job | Collectr / HoloDex / TCG Grading / PSA | CardFlow |
|----------|----------------------------------------|----------|
| Add what I just bought | Scan → instant collect | Collection Scan → Confirm → Purchased |
| Remember a card I did not buy | Wishlist | Watchlist segment · no draft |
| Know what I can pay | Live market | User reference + Max Buy guidance |
| Pre-grade before I mail | TCG Grading AI 1–10 | Manual four-pillar checklist on Grading → Prepare |
| Track a PSA order | PSA app submissions | Grading → Submitted / Returned, user-typed IDs |
| List it for sale | Collectr marketplace / PSA eBay | Export → Copy listing draft · no publish |
| Live show hunting | Whatnot/eBay live + Brickify-style overlay | In-app browser + live-video identify (YOLO + card-identity) + PokéCollector estimate / Max Buy. No scrape, no auto-bid |

---

## Implementation order

Do **not** implement from this list. Use [TAB_LAYOUT_TASKS.md](./TAB_LAYOUT_TASKS.md) (Tasks 1–19).

1. **Collection** — add the counts row; keep scan strip, search, segments, grid, empty/error. Do not restyle.
2. **Export** — destination list + ready-to-copy rows wired to existing drafts. Fastest honest tab.
3. **Shop** — three job rows, no fake catalog.
4. **Grading** — Prepare / Submitted / Returned as **local layout + user fields**. Persistence can wait on the mock API until a later task; do not invent a PSA client.
5. **Livestream** — layout: in-app browser + overlay strip ([TAB_LAYOUT_TASKS.md](./TAB_LAYOUT_TASKS.md)). Identify: live video, not this layout file ([VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) Phase 6).

After each: `pnpm test` · `pnpm typecheck` · still-photo loop (scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy).
