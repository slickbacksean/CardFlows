# Wireframe implementation tasks

Do these **in order**. One task at a time. Check the box when the “Done when” line is true.

**Now:** Phase A–D is ready for review. Do not start later roadmap steps until accepted.  
**Done:** Tasks 1–14 (theme, bottom tabs, app header, card tile, hide mock scenarios from Home, Home, Inventory tab, Capture, Confirm, Card detail, Purchase sheet, Watchlist sheet, Max Buy rules, Listing draft restyle). Watch tab and Settings-as-tab are not in this list — watchlist lives on Collection; Settings opens from the avatar.

**Follow:** [WIREFRAMES.md](./WIREFRAMES.md) for layout and copy.  
**Rules:** [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md) — do not rewrite it.  
**Order:** [ROADMAP.md](./ROADMAP.md) step 2 (split routes to match frames). Still mock recognition/catalog. No live vendor HTTP.

Stay on the existing mock API. Do not add Publish, AI grading, live prices, profit labels, or real camera until a later task says so.

Tab bar (product, after Tasks 2–4):

```
 Collection   (O)   Shop   Grading   Export
           Livestream Screener
```

Collection is the default tab. Center Livestream Screener is disabled. Capture starts from Collection. Watch and Settings are not tabs; Settings opens from the avatar. Shop / Grading / Export are placeholder tabs. Home and Search are not tabs.

```sh
pnpm test
pnpm typecheck
# After each task that touches UI, run the loop:
# scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy
```

---

## Before you start

- [x] Read [WIREFRAMES.md](./WIREFRAMES.md) “UI template”, “Copy rules”, and “Navigation”.
- [x] Skim [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md) (IDs, Confirm before CRM write, Max Buy, drafts).

Current scaffold (do not delete the loop — restyle and split it):

| Today | Becomes |
|-------|---------|
| [apps/mobile/app/index.tsx](../apps/mobile/app/index.tsx) | Home tab + Collection tab (purchased + watchlist) |
| [apps/mobile/app/scan/[scanId].tsx](../apps/mobile/app/scan/[scanId].tsx) | Confirm (tab bar hidden) |
| [apps/mobile/app/decide/[cardflowCardId].tsx](../apps/mobile/app/decide/[cardflowCardId].tsx) | Detail, then Purchase / Watchlist sheets |
| [apps/mobile/app/draft/[draftId].tsx](../apps/mobile/app/draft/[draftId].tsx) | Listing draft (tab bar hidden) |
| Missing (now implemented) | Capture, Max Buy rules, About (from Settings via avatar) |

---

## Phase A — Shared chrome

### Task 1 — Theme

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) “UI template” (brand).

- Keep gold `#E8C547` for wordmark and selected tab.
- Add a bright blue for filled primary CTAs (Scan / Confirm / Save), like HoloDex “Collect”.
- Touch: [apps/mobile/lib/theme.ts](../apps/mobile/lib/theme.ts), [apps/mobile/components/ui/primary-button.tsx](../apps/mobile/components/ui/primary-button.tsx).

**Done when:** Primary buttons can be gold or blue; dark canvas tokens are unchanged.

### Task 2 — Bottom tabs

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) tab bar.

```
 Home   Inventory   (O)   Watch   Settings
                 Scan
```

- Use Expo Router tabs. Raised **center Scan** opens Capture (do not run identify on tab press alone).
- Tab bar **hidden** on Capture, Confirm, Detail, Purchase, Draft, Max Buy rules.
- Touch: new `apps/mobile/app/(tabs)/_layout.tsx` and tab screens; keep a root stack in [apps/mobile/app/_layout.tsx](../apps/mobile/app/_layout.tsx).

**Done when:** Four tabs plus center Scan exist. Scan does not mint `cardflow_card_id`.

**Do not:** Live video ID. Multi-TCG tabs. An “AI Grading” tab.

### Task 3 — App header

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §1 header.

- Shared header: `CardFlow` wordmark, `USD`, bell (no-op), avatar → Settings.
- Touch: new component e.g. `apps/mobile/components/ui/app-header.tsx`. Use it on Home and Collection.

**Done when:** Home and Collection share one header. Bell does not invent alerts.

### Task 4 — Card tile

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §1b, §6, §7 (2-column grid).

- Tile: catalog art, name, `#` + EN, purchased vs watching, all-in or target Max Buy.
- Purchased with a draft shows **Draft**. Watchlist copy: cannot draft.
- Touch: new `apps/mobile/components/ui/card-tile.tsx`.

**Done when:** One tile component can render empty-grid placeholders later; art is catalog display only.

### Task 5 — Hide mock scenarios from product Home

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) “Dev-only”.

- Move High / Ambiguous / No card / Timeout / Rate limit / No match **off** Home.
- Keep them reachable in `__DEV__` only (e.g. long-press Scan or a DEV panel on Capture).

**Done when:** Product Home has no scenario chips. You can still pick a mock scenario while developing.

---

## Phase B — Tab screens

### Task 6 — Home

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §1a empty, §1b populated, §1c error.

- Recent purchased + watchlist tiles. Empty copy: scan does not create inventory.
- Tap purchased tile → draft (create or open). Tap watchlist tile → detail, **not** draft.

**Done when:** Empty, populated, and load-error states match the frames. Loop still saves via API.

### Task 7 — Inventory tab

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §6.

- Search. Segment **Purchased | Watchlist**. 2-column grid. Draft CTA on purchased only.
- Empty purchased copy from §6b.

**Done when:** Purchased list matches inventory API. Watchlist segment does not open a draft.

---

## Phase C — Scan → Confirm → Detail → Save

### Task 8 — Capture screen (mock still)

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §2a–2d.

- Full screen, tab bar hidden. Card-shaped frame. `(X)` cancel. Gallery left, shutter center.
- Shutter and gallery still `POST /v1/scans` with a mock scenario (real camera is a later roadmap step).
- Cancel: no `cardflow_card_id`. Permission-denied copy from §2c (can be a static state until real camera).

**Done when:** Shutter → Confirm route. `(X)` returns to the previous tab. No inventory row from capture alone.

**Do not:** `expo-camera` live identify. Continuous streaming.

### Task 9 — Confirm identity

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §3a–3g.

- Restyle [apps/mobile/app/scan/[scanId].tsx](../apps/mobile/app/scan/[scanId].tsx): your picture vs matching thumbs, filled **Confirm identity**, reject/retake.
- Cover: high (still Confirm), ambiguous picker, no card, timeout, rate limit, no catalog match.
- High+High still requires Confirm. CRM write still blocked.

**Done when:** Each mock scenario shows the matching frame. Confirm still mints `cardflow_card_id` only then.

### Task 10 — Card detail

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §4a, §4b.

- Split [apps/mobile/app/decide/[cardflowCardId].tsx](../apps/mobile/app/decide/[cardflowCardId].tsx): this screen is identity + reference + Max Buy only.
- Hero catalog art, pills (set, #, EN, variant). User-typed reference. Missing reference copy from §4b.
- CTAs: Purchased, Watchlist, Edit Max Buy rules.
- No PSA strip, no profit, no “portfolio gaining value”.

**Done when:** You can open detail after Confirm without saving inventory yet.

### Task 11 — Purchase sheet

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §5a, §5c.

- Sheet over detail. Required: purchase price, purchased at, currency. Optional lines default 0. Show all-in.
- Validation: purchase price required. Success → Collection tab, Purchased segment (`acquired`).

**Done when:** Purchase-price-only saves. Watchlist is not this sheet.

### Task 12 — Watchlist sheet

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §5b.

- Not owned, no cost, no draft. Target Max Buy as reminder. Success → Collection tab, Watchlist segment (`watching`).

**Done when:** Watchlist save does not create a draft path.

---

## Phase D — Preferences + draft restyle

### Task 13 — Max Buy rules

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §8.

- Push from Settings (avatar) and from Detail. Defaults 20% / 13% / USD / factor 1.0.
- Copy: later edits recompute guidance. Invalid margin message from §8b.
- Wire to existing `GET /v1/preferences` (PATCH only if the API already allows it; otherwise local + GET for now).

**Done when:** Opening rules shows current defaults. No bid / fee-schedule UI.

### Task 14 — Listing draft restyle

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §9.

- Keep current draft API behavior. Match the frame: hero art, title/condition/asking, spread **never profit**, disclosure chips, Copy omits notes, no Publish.
- Missing-fields state §9b. Watchlist cannot open §9d.

**Done when:** Purchased → draft → ready for review → Copy still works. No Publish control.

---

## Stop here

Phase A–D is [ROADMAP.md](./ROADMAP.md) step 2. Do **not** start these until A–D is accepted:

| Later | Roadmap |
|-------|---------|
| Real `camera_photo` / library still hitting **mock** identify | Step 3 — [STILL_IMAGE_CAPTURE_TASKS.md](./STILL_IMAGE_CAPTURE_TASKS.md) |
| Durable DB, **real** IdP / live CardSight / TCGdex | Step 5 |
| Private-beta identity / Settings close-out | Step 4 — [PREFERENCES_SETTINGS_TASKS.md](./PREFERENCES_SETTINGS_TASKS.md) |
| Pricing provider | ON by default (server `CARD_FLOW_PRICING_ENABLED`, Sean's decision Oct 2026) |
| `listed` / `sold` / publish / scrape / auto-grade | Do not build |

---

## Definition of done (this file)

- [x] Tab bar matches the product bar in this file (not the original four-tab ASCII in [WIREFRAMES.md](./WIREFRAMES.md)); Capture starts from Collection (Livestream Screener stays disabled).
- [x] Empty and error states exist for Collection and Confirm failures.
- [x] Scan alone does not create inventory. Confirm still required.
- [x] Purchased and Watchlist save onto Collection (correct segment). Only Purchased drafts.
- [x] Copy still omits private notes. No Publish.
- [x] `pnpm test` and `pnpm typecheck` pass.
- [x] Dev-only mock scenarios still reachable; not on product Home.
