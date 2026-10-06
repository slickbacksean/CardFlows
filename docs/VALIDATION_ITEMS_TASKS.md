# Validation items tasks (Roadmap step 5)

Do these **in order**. One task at a time. Check the box when the “Done when” line is true.

**Now:** [ROADMAP.md](./ROADMAP.md) step 5 work in this file is done. Overlay chrome (Task 26) is in the livestream strip (back/forward, page ON vs scanner ON). Tests stay on mocks; local stack may inject PokéCollector + OBB + pHash.  
**Already in the app:** Scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy on **SQLite** + invite sessions. Capture stills use **YOLO OBB + pHash** when enabled (tests stay mock). Public TCGdex catalog is live (CardFlow adapter strips `pricing` on that path). PokéCollector is catalog/price/collection SoR over HTTP. Livestream scanner ON is **live video** YOLO + card-identity; overlay guess is read-only and does not write inventory.  
**Keep:** Tab bar as-is. Capture / Settings / About / Max Buy stay stack screens. Confirm before inventory. Overlay guesses do **not** mint `cardflow_card_id` or write collection. USD only. No Apple/Google wall.  
**Follow:** [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md) IDs + Max Buy + drafts (do not rewrite the brief); [CRM_DATA_MODEL.md](./CRM_DATA_MODEL.md) §13–14; [TCGDEX_ARCHITECTURE.md](./TCGDEX_ARCHITECTURE.md); [CARD_ID_MAPPING_PLAN.md](./CARD_ID_MAPPING_PLAN.md). Capture identify follows [Pokemon-TCGP-Card-Scanner](https://github.com/1vcian/Pokemon-TCGP-Card-Scanner) (pipeline only). Grading Prepare photo estimate follows [casecomp](https://github.com/Pyronewbic/casecomp) **pipeline only**; slab comps are [PokeTrace](https://poketrace.com/) — see [GRADING_PREPARE_TASKS.md](./GRADING_PREPARE_TASKS.md).  
**Rules:** Do not rewrite the brief. Founder exceptions in this file and [ROADMAP.md](./ROADMAP.md) beat older “pricing OFF / CardSight still identify / overlay is not live ID” lines.  
**Non-goals:** [NON_GOALS.md](./NON_GOALS.md) — no screenshot of the livestream as identify, no CardSight on Capture or livestream, no continuous phone-camera ID product, no Whatnot/eBay scrape, no auto-bid / publish / account automation. Do not run `tcgdex/server`. Do not vendor [PokeMoney](https://github.com/destinio/pokecardprices). Do not copy [PokéCollector](https://github.com/Git-Romer/pokecollector) AGPL source. Do not import TCG Pocket JSON/images as the CardFlow catalog. Do not use PokéCollector Gemini. Do not copy [casecomp](https://github.com/Pyronewbic/casecomp) or [tcg-oracle-app](https://github.com/sailorpepe/tcg-oracle-app) source.

**Founder exceptions (this file):**

- **PokéCollector** (unmodified GHCR + Postgres) is the system of record for cards, market estimates, collection, wishlist, and portfolio. CardFlow SQLite keeps sessions, Max Buy prefs, listing drafts, and scan image refs.
- Overlay and portfolio may show TCGdex Cardmarket/TCGPlayer fields **via PokéCollector**. Prefer TCGPlayer USD when present. Never copy `pricing` onto listing drafts. Never claim a bid or profit.
- Livestream identify is **in-stream live video**: combined **YOLO + card-identity** model. Not a screenshot, not Capture.
- Capture stills use **YOLO11 Nano OBB + RGB perceptual hash** against English TCGdex art (`tcgdex_id`). Not CardSight. Not the TCG Pocket image set.
- **Grading Prepare** may show a photo **estimate** (casecomp approach, CardFlow-owned code). Not a cert, not listing `condition`. [PokeTrace](https://poketrace.com/) slab comps are **later** — keep the reference, do not ship them in this file. No casecomp or [tcg-oracle-app](https://github.com/sailorpepe/tcg-oracle-app) source. Follow [GRADING_PREPARE_TASKS.md](./GRADING_PREPARE_TASKS.md) — do not block this file’s Capture / livestream sequence on it.

Step 5 is **not** a blocker for the mock CRM loop. After every task that can affect the loop, the mock path must still complete without vendor keys or PokéCollector.

```sh
pnpm test
pnpm typecheck
# After any task that can affect the loop:
# scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy
# Then: restart the API process and confirm Collection still has the copy
```

**Sequence (do not skip ahead):** persistence → invite sessions → public TCGdex catalog → still upload → **Capture YOLO OBB + pHash** → **PokéCollector SoR** → **in-stream YOLO + identity**. Overlay guess must not write collection. Never identify the livestream from a screenshot. Never call CardSight.

---

## Before you start

- [x] Read [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md) IDs, providers, Must never.
- [x] Skim [CRM_DATA_MODEL.md](./CRM_DATA_MODEL.md) §13 (never store) and §14 (table sketch). This file **does** add the MVP tables; it does **not** add `listed` / `sold`.
- [x] Skim [CARDSIGHT_INTEGRATION_RECOMMENDATION.md](./CARDSIGHT_INTEGRATION_RECOMMENDATION.md) §§2–9 (server-only key, 20 MB, error map, manual search).
- [x] Skim [TCGDEX_ARCHITECTURE.md](./TCGDEX_ARCHITECTURE.md) §§2–6 (public API, strip `pricing`, cache, no self-host).
- [x] Confirm [apps/api/src/store.ts](../apps/api/src/store.ts) is in-memory Maps and `POST /v1/scans` calls `identifyCardMock` with **no** image bytes ([apps/api/src/app.ts](../apps/api/src/app.ts)).
- [x] Confirm Settings has **no** CardSight key field and **no** Apple / Google wall.

**Done when (Phases 1–3):** You will not put vendor secrets on the device or add a mandatory sign-up screen. Capture identify is OBB + pHash (no CardSight key). Phases 5–6 may show estimates via PokéCollector. Livestream ID is live video, not stills.

---

## Phase 1 — Durable persistence

The mock store shape stays. Rows survive an API restart. Tests may keep an in-memory adapter.

### Task 1 — Store port (no schema yet)

- [x] Done.

Touch: extract a port from [apps/api/src/store.ts](../apps/api/src/store.ts) (same function names the routes already call). Keep the current Maps implementation behind it.

- `createApp` takes the store (or a factory). Vitest / route tests can still use memory.
- Do **not** add SQLite, HTTP client, or new routes in this task.
- Process-global `activeUserId` may remain until Phase 2.

**Done when:** Routes go through the port. `pnpm test` and `pnpm typecheck` pass. Behavior unchanged.

**Do not:** Prisma/Drizzle yet. Vendor HTTP.

---

### Task 2 — MVP schema from the CRM sketch

- [x] Done.

Follow: [CRM_DATA_MODEL.md](./CRM_DATA_MODEL.md) §14 and [CARD_ID_MAPPING_PLAN.md](./CARD_ID_MAPPING_PLAN.md) §3. Use Drizzle (or equivalent) in `apps/api`.

MVP tables only:

- `cardflow_cards` — unique `(language, tcgdex_id)`. PK is CardFlow UUID.
- `card_external_ids` — `tcgdex` / `cardsight` refs. Never the inventory PK.
- `crm_scans` — includes nullable `image_storage_ref` (fill in Task 5).
- `crm_confirmations`
- `crm_inventory_items` — purchased is one row per copy; watchlist is interest.
- `crm_purchases` — cents; `reference_price_source` is `user_entered` or `none` (not `tcgdex_pricing`).
- `crm_listing_drafts` — already owned by `user_id`; Copy still omits `notes`.
- `user_preferences` — Max Buy rules per invited `user_id`.

Money: persist **cents**. Display dollars as today.

**Done when:** Migrations exist and apply to an empty SQLite file. Unique `(language, tcgdex_id)` is enforced. No `listed` / `sold` / `shipped` columns.

**Do not:** `crm_storage_locations` as a product surface. Price snapshots from a live provider. Full audit log UI.

---

### Task 3 — SQLite adapter

- [x] Done.

- Dev: gitignored file (e.g. `apps/api/data/cardflow.sqlite`). Tests: `:memory:`.
- Env: `CARD_FLOW_SQLITE_PATH`. Missing path in test = memory.
- Gitignore the db file and `apps/api/data/`. Add `apps/api/.env.example` with empty values — **no real secrets**.
- Memory adapter remains available (`CARD_FLOW_STORE=memory`) so CI does not need a disk.

**Done when:** A local API using SQLite can boot, apply migrations, and serve `/health`. Tests still pass in memory.

**Do not:** Postgres/hosted DB in this file. Cloud object storage.

---

### Task 4 — Routes write the durable store

- [x] Done.

Touch: [apps/api/src/app.ts](../apps/api/src/app.ts), SQLite adapter.

- Default local `pnpm dev:api` uses SQLite. `pnpm test` stays on memory unless a test opts in.
- Restart the API process: Collection inventory, drafts, and Max Buy prefs for the same invited user are still there.
- Confirm still mints/reuses `cardflow_card_id` only on Confirm. Scan still does not create inventory.
- Rows stay filtered by `user_id`. Switching testers still does not mint inventory.

**Done when:** Kill and restart the API, then `GET /v1/inventory` as the same user returns the Purchased copy. Watchlist tiles still recompute Max Buy from **current** prefs + stored reference.

---

### Task 5 — First-party scan image ref

- [x] Done.

Touch: [apps/mobile/lib/api.ts](../apps/mobile/lib/api.ts), [apps/mobile/app/capture.tsx](../apps/mobile/app/capture.tsx), [apps/api/src/app.ts](../apps/api/src/app.ts).

- `POST /v1/scans` accepts the still (`multipart` jpeg/png/webp, max **20 MB**) **or** keeps JSON-only in `__DEV__` mock-scenario chips when no file is sent.
- Store bytes under a first-party path keyed by `scan_id`. Save `image_storage_ref` + mime on `crm_scans`.
- Confirm “Your picture” may load from `GET /v1/scans/:id/image` if the local URI is gone. **Never** use this URL as catalog art (tiles, drafts, overlay stay TCGdex).
- Do **not** forward the file to CardSight yet.

**Done when:** A camera or library still survives API restart and still shows on Confirm as “Your picture,” not as catalog art.

**Do not:** Client `fetch` to `api.cardsight.ai`. Analytics of image bytes.

---

### Task 6 — Persistence loop check

- [x] Done.

- `pnpm test` · `pnpm typecheck`.
- Manual: scan → confirm → Purchased → draft → Copy. Restart API. Collection still shows 7the copy. Copy still omits notes.

**Done when:** Durability is proven on the existing mock identify/catalog path. No live vendor required.

---

## Phase 2 — Invite sessions (beta auth)

Replace process-global `activeUserId` with a **request-scoped** invited user. Keep the two mock testers. No sign-up wall ([WIREFRAMES.md](./WIREFRAMES.md) §10c).

### Task 7 — Invite codes

- [x] Done.

Touch: [packages/shared/src/identity.ts](../packages/shared/src/identity.ts), [apps/api/src/app.ts](../apps/api/src/app.ts).

- Each invited tester gets a documented invite code (not a password, not Apple/Google).
- `POST /v1/sessions` `{ inviteCode }` → `{ token, identity }`. Unknown code → `400`/`401` with a short error. Do not mint `cardflow_card_id`.
- Settings switcher uses this (or a thin wrapper) instead of a process-global PATCH that other devices would race.

**Done when:** Alex’s code cannot open Jordan’s session. No OAuth buttons.

**Do not:** Clerk/Auth0. Email/password. Magic links. Marketplace OAuth.

---

### Task 8 — Durable session rows + request user

- [x] Done.

- Table `crm_sessions`: hashed token, `user_id`, created/expires. Return the raw token **once**.
- Routes that read/write CRM take `Authorization: Bearer <token>` (or equivalent). Resolve `user_id` **per request**. Delete process-global `activeUserId` as the write authority.
- `GET /v1/identity` returns the session’s identity + invited list.
- `CARD_FLOW_DEV_AUTO_SESSION=true` (local default): missing header acts as the default invited user so Capture is not blocked. Staging/prod: missing header → `401` on CRM writes, still **no** full-screen sign-up wall in the app.

**Done when:** Two concurrent sessions on one API process keep separate inventories. Tests pass a token (or use auto-session).

---

### Task 9 — Mobile session restore

- [x] Done.

Touch: [apps/mobile/lib/identity.ts](../apps/mobile/lib/identity.ts), [apps/mobile/lib/api.ts](../apps/mobile/lib/api.ts), Settings.

- Persist the token with `expo-secure-store` (native). Memory fallback on web.
- Cold start: restore token → `GET /v1/identity`. If none, local/dev auto-session or redeem the **default** invite — Collection and Capture still open.
- Settings kicker stays the invited label. Switch tester / “Not this tester” redeems the other (or default) invite and **replaces** the stored token. Confirm copy if inventory would look gone (already in shared).
- Livestream overlay still clears/reloads on switch.

**Done when:** Killing the mobile app keeps the same invited user. Capture is not behind login. No avatar photo upload.

---

### Task 10 — Session loop check

- [x] Done.

- `pnpm test` · `pnpm typecheck`.
- Manual: as Alex, save Purchased. Switch to Jordan (confirm). Jordan Collection empty. Switch back. Alex copy restored after **API restart**.

**Done when:** Identity is durable and request-scoped. There is still no Apple/Google wall.

---

## Phase 3 — Live TCGdex (catalog)

Recognition can stay mock. Mapper becomes catalog-backed and async.

### Task 11 — `CardCatalogProvider` + mock adapter

- [x] Done.

Follow: [TCGDEX_ARCHITECTURE.md](./TCGDEX_ARCHITECTURE.md) §4.

- Interface: `getCardById`, `getCardBySetAndLocalId`, `resolveSetByName`, `listCards`. `language` is `'en'` only.
- Mock adapter wraps existing `packages/shared/fixtures/tcgdex-*.json`.
- `mapRecognitionToCatalog` uses the provider (async). Fixture tests stay green on mock.
- Adapter **strips** `pricing` / `variants_detailed` pricing even on fixtures.

**Done when:** Mapper tests do not call the network. `provider: 'mock'`. Confirm-before-inventory still required.

---

### Task 12 — Live TCGdex adapter behind a flag

- [x] Done.

- `@tcgdex/sdk` (or GET `https://api.tcgdex.net/v2`). `new TCGdex('en')`. `setCacheTTL` ≥ 3600.
- Flag `tcgdex_catalog_enabled`: on in local/staging when network is allowed; off → `FEATURE_DISABLED` and manual search. `tcgdex_self_hosted` stays **`false`**. `tcgdex_pricing_ignored` stays **`true`**.
- Timeouts **5–8s**. Retry `5xx` only (max 2). Never retry `404`. Never invent a TCGdex id.
- **No** `TCGDEX_API_KEY`. Do not run `tcgdex/server` or import the cards-database.

**Done when:** With the flag on, `GET` `base1-58` returns catalog fields with **no** pricing key on the DTO. With the flag off, CI still uses mock.

---

### Task 13 — Manual catalog search on Confirm

- [x] Done.

Touch: [apps/mobile/app/scan/[scanId].tsx](../apps/mobile/app/scan/[scanId].tsx), new `GET /v1/catalog/search`.

- Confirm frames that already say “search manually” (no-match, timeout, rate-limit, ambiguous) get a real English **set + number** search. Name-only must not auto-confirm ([CARD_ID_MAPPING_PLAN.md](./CARD_ID_MAPPING_PLAN.md)).
- Outage: user-safe copy; if a **last good cached** `{language, tcgdex_id}` exists, show it as cached — do not mint from CardSight alone.
- Picker + Confirm still required. High+High still does not skip Confirm.

**Done when:** A tester can Confirm `base1-58` from search when identify/catalog mapping is empty. Scan still does not write inventory.

---

### Task 14 — Confirm caches catalog on the canonical row

- [x] Done.

- After Confirm, persist catalog cache on `cardflow_cards` (name, set, localId, image base URL, variants). Refresh may update cache; it must **not** change `cardflow_card_id`.
- `GET /v1/cards/:id` and Collection tiles work if TCGdex is down **after** confirm (CRM cache).
- Overlay / drafts still use TCGdex constructed URLs, never the user still.

**Done when:** Unplug catalog (flag off) after Confirm: Detail and Collection still show the confirmed card. Pricing still absent.

---

## Phase 4 — Capture still identify (YOLO OBB + pHash)

Still image **from Capture only** (Collection / Shop). Pipeline from [Pokemon-TCGP-Card-Scanner](https://github.com/1vcian/Pokemon-TCGP-Card-Scanner): **YOLO11 Nano OBB** locates the card, **24-bit RGB perceptual hash** matches official art.

That repo is built for **TCG Pocket** screenshots. CardFlow is **English physical TCG**. Take the detect + hash approach; **do not** copy their Pocket card JSON, Pocket images, or React/TensorFlow.js app into Expo. Hash index is keyed by `tcgdex_id` from TCGdex English constructed art (or PokéCollector-cached art). Retrain/fine-tune the OBB on physical camera stills if the Pocket-trained weights fail on real photos.

Confirm still required. Scan still does not write inventory. **Do not** use this pipeline on the livestream tab. **Do not** call CardSight. `cardsight_identify_enabled` / `cardsight_pricing_enabled` / `cardsight_live_video_enabled` stay **false**.

### Task 15 — `CardRecognitionProvider` + mock adapter

- [x] Done.

- `identifyCard({ image, mimeType })` → `CardFlowNormalizedRecognitionResult`.
- Mock adapter = today’s `identifyCardMock` + DEV scenario. `POST /v1/scans` uses the provider.
- `__DEV__` chips still force mock scenarios when the live OBB/hash path is off.

**Done when:** CI identify is still fixtures. Product UI cannot enable CardSight.

---

### Task 16 — Identify uses the stored still

- [x] Done.

- After Task 5 persist, pass **server** bytes (`image_storage_ref`) into `CardRecognitionProvider`. Do not re-upload from the phone to a third-party identify API.
- Zod: mime enum, 20 MB, reject extra form fields.
- JSON-only DEV chips: skip live OBB/hash; keep mock scenario.

**Done when:** Live Capture identify (when enabled) reads `image_storage_ref`. Missing/oversize image does not run the model.

---

### Task 17 — YOLO11 Nano OBB + RGB pHash adapter

- [x] Done.

- Detect: YOLO11 Nano **OBB** on the stored still (export CoreML / TFLite for native; server-side ONNX is OK for v1). Crop the best box.
- Match: 24-bit **RGB perceptual hash** vs a precomputed English art index `{tcgdex_id, hash}`. Hamming-distance threshold; return ranked candidates (High / Medium / Low) in the existing DTO. Never invent a `tcgdex_id`.
- Build/refresh the hash index from TCGdex English image URLs (or PokéCollector art cache). Gitignore bulky artifacts. CI uses a tiny fixture index.
- No Pocket catalog. No CardSight HTTP. Mapper then uses the **catalog** provider for name/set/number/art.

**Done when:** A camera still of `base1-58` (or fixture) returns that `tcgdex_id` as a candidate without CardSight. Mobile response has **no** API key and **no** Pocket blob.

**Do not:** Vendor `pokemon-tcgp-card-scanner` UI. Livestream identify. CardSight.

---

### Task 18 — Fail-soft Confirm copy

- [x] Done.

Touch: Confirm screen + shared error copy.

- No box / no hash match / ambiguous: short **user-safe** message + Search manually. Prefer “We couldn't confirm this card — search by English set and number.”
- Ambiguous: picker **and** Search manually.
- Flag off / mock: same Confirm path. Do not claim accuracy or “CardFlow verified authentic.”

**Done when:** A bad photo still lets a tester Confirm via search and save Purchased.

---

## Phase 5 — PokéCollector data plane

Cards, market estimates, collection, wishlist, and portfolio live in [PokéCollector](https://github.com/Git-Romer/pokecollector). CardFlow does **not** copy that AGPL codebase. Run unmodified GHCR images. Pin a release tag (not `latest`). English sync only (`TCGDEX_SYNC_LANGUAGES=en`).

### Task 19 — Compose PokéCollector next to the API

- [x] Done.

- Local `pnpm dev:api` (or a documented compose file) can start PokéCollector + Postgres. Gitignore volumes. `.env.example` has empty secrets only.
- First-run English set/card sync. Do **not** run `tcgdex/server`.
- CI and `pnpm test` stay on mocks; they must not require Docker Postgres.

**Done when:** A local stack can health-check PokéCollector. Tests still pass without it.

**Do not:** Copy `backend/` or `frontend/` into `apps/` or `packages/`. Track `latest`. Enable binders, decks, Telegram, public trainer social, or sealed P&L.

---

### Task 20 — Catalog + pricing ports over HTTP

- [x] Done.

- `PokecollectorCatalogProvider` implements the existing catalog port (English `getCardById` / set + localId). Art stays constructed TCGdex URLs.
- `PokecollectorPricingProvider` returns a CardFlow estimate DTO (cents, USD). Prefer TCGdex TCGPlayer USD when present; otherwise convert Cardmarket EUR. Label as estimate, not a market or a bid.
- Flag off / unreachable → overlay and Collection fail soft; Capture Confirm still works on mock/catalog cache.
- Listing drafts still **must not** persist vendor `pricing` blobs.

**Done when:** `GET` `base1-58` through CardFlow returns catalog fields. A separate pricing call can return USD cents or null. Mobile never sees a PokéCollector URL or JWT.

---

### Task 21 — Invite session maps to a PokéCollector user

- [x] Done.

- On invite redeem, the API upserts a PokéCollector user and stores the mapping **server-side** only.
- Testers never see a PokéCollector login wall. Expo keeps the CardFlow invite token.
- Switching Alex ↔ Jordan switches the mapped collection. Overlay clears on switch (already required in Task 9).

**Done when:** Two invited sessions cannot read each other’s PokéCollector collection. No PokéCollector JWT in SecureStore.

---

### Task 22 — Collection and portfolio read PokéCollector

- [x] Done.

- Collection Purchased | Watchlist tiles and counts read PokéCollector collection vs wishlist.
- Portfolio summary is an **estimate**, never “profit.” USD only.
- Confirm (Capture) writes a PokéCollector collection or wishlist row — still not on scan alone, still not from livestream overlay.
- CardFlow SQLite is no longer inventory SoR. Drafts and Max Buy prefs stay in CardFlow, keyed to the confirmed copy / `tcgdex_id` as already designed.

**Done when:** Kill CardFlow API **and** PokéCollector, restart both: same invited user still sees the Purchased copy. Draft Copy still omits notes.

---

## Phase 6 — Livestream in-stream scanner (no screenshots)

User opens the in-house Whatnot | eBay browser, turns the scanner **on**, and the model reads the **live video**. Combined **YOLO + card-identity** finds a card in the stream and names the exact printing (`tcgdex_id`) in real time. PokéCollector then supplies the USD estimate. Overlay guesses do not write inventory.

**Must not:** screenshot or view-shot the page, POST a jpeg still of the livestream, send the user to Capture, run CLIP (or CardSight) on a screenshot, scrape DOM, or use PokéCollector Gemini.

**Research later:** overlay strip layout/copy. Do not block live identify on chrome polish. Do not use Capture OBB/pHash on the livestream tab.

### Task 23 — In-house live browser + scanner control

- [x] Done.

Touch: [apps/mobile/app/(tabs)/scan-tab.tsx](../apps/mobile/app/(tabs)/scan-tab.tsx).

- Load the live Whatnot / eBay page in-app. No DOM scrape, no bid injection, no login interception.
- Scanner **OFF** by default. ON starts **live-video** identify (Phase 6). OFF / tab blur / tester switch **stops the model**.
- Remove “Scan a still photo” from this tab. Capture stays on Collection only.

**Done when:** A tester can watch a live show and toggle the scanner without leaving the tab. Toggling ON does not take a screenshot.

---

### Task 24 — Combined YOLO + card-identity on live video

- [x] Done.

- One pipeline: detect the card **and** classify the exact English printing (`tcgdex_id`) from the **live video**, not from a still of the page.
- Native iOS/Android. Web may show “scanner unavailable.”
- Scanner OFF / no card in view → no identity. Never invent a `tcgdex_id`.
- Do **not** use `react-native-view-shot`, WebView screenshot APIs, or `POST /v1/scans` for this tab.
- Ultralytics AGPL: do not ship weights without a license decision. Do not vendor [Pokemon-Card-Scanning-Webapp](https://github.com/ShreyShingala/Pokemon-Card-Scanning-Webapp) weights or scrapers.

**Done when:** With scanner ON, a card visible in the live show can resolve to a `tcgdex_id` without Capture and without a saved screenshot. Scanner OFF emits nothing.

---

### Task 25 — Live identity → PokéCollector estimate

- [x] Done.

- When Task 24 reports a stable `tcgdex_id`, fetch catalog + USD estimate via Phase 5 providers. Compute **display** Max Buy from **current** prefs + that ephemeral reference (`referenceSource: "tcgdex_via_pokecollector"`).
- **Do not** write `crm_scans`, inventory, or PokéCollector collection from this path.
- Safe DTO: name, set, number, constructed art, estimate cents or null, max-buy or null, confidence. No keys, no vendor blobs, no `cardflow_card_id`.

**Done when:** Mock providers return an estimate (or null) for a live `tcgdex_id` without Docker. A live guess never creates inventory.

---

### Task 26 — Overlay chrome

- [x] Done.

- Browser **back/forward**, page-ON vs scanner-ON. Do **not** restore “Scan a still photo” / “Overlay is not live ID.”

---

## Phase 7 — Honesty, health, loop

### Task 27 — Health + Settings stay honest

- [x] Done.

- `/health` may report `pricingProvider: "off" | "pokecollector"`, `recognition: "mock" | "obb_phash"`, `livestreamIdentify: "off" | "yolo_identity"`, `catalog: "mock" | "tcgdex" | "pokecollector"` — **not** keys, **not** a Settings form.
- Settings: marketplace **automation** stays OFF with no in-app enable path. Overlay/livestream/pricing may be on for invited testers when the stack is up. No vendor key fields, no CardSight key on device.
- About: catalog is TCGdex (via PokéCollector for collection/prices). Capture identify is YOLO OBB + pHash on a still. Livestream is YOLO + card-identity on live video. Grading Prepare may show a photo estimate. Link PokéCollector AGPL source and credit the TCGP-scanner **approach**. No publish.

**Done when:** A tester cannot start marketplace automation, a paywall, or live-key entry from Settings.

---

### Task 28 — Full loop + flags

- [x] Done.

- `pnpm test` · `pnpm typecheck` without vendor keys and without PokéCollector (mocks).
- Manual (mock): scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy. Restart API. Session + drafts survive.
- Manual (local stack): Capture still → OBB + pHash candidates → Confirm → PokéCollector collection. Livestream scanner ON identifies from **live video** (not this still pipeline). Guess does not add a copy. Copy omits notes. USD only.
- No Whatnot/eBay scrape. No CardSight. No `listed` / `sold`.

**Done when:** Capture CRM loop and livestream overlay both work with **or without** live HTTP (mocks). PokéCollector is swappable behind the ports.

---

## Stop here

Do **not** start these in this file:

| Later | Why not now |
|-------|-------------|
| Screenshot / view-shot / CLIP-on-jpeg livestream identify | [ROADMAP.md](./ROADMAP.md): live video only |
| Overlay strip polish / “Scan a still photo” CTA | Do not restore screenshot Capture from this tab |
| CardSight HTTP / pricing / live video | Replaced on Capture by OBB + pHash; never on livestream |
| TCG Pocket JSON/images as CardFlow catalog | [Pokemon-TCGP-Card-Scanner](https://github.com/1vcian/Pokemon-TCGP-Card-Scanner) is Pocket, not physical TCG |
| PokeMoney / pokemontcg.io / official TCGPlayer API | [pokecardprices](https://github.com/destinio/pokecardprices) is not the price DB |
| Clerk / Auth0 / mandatory Apple or Google wall | [WIREFRAMES.md](./WIREFRAMES.md) §10c; invite codes are the beta auth in this file |
| Run `tcgdex/server` / import cards-database into CardFlow | PokéCollector sync is the replica; CardFlow still does not host TCGdex |
| PokéCollector Gemini scanner, binders, decks, Telegram, social, sealed P&L | Out of this slice |
| Continuous phone-camera live ID | [NON_GOALS.md](./NON_GOALS.md); livestream is in-browser live video, not the phone camera |
| Durable locations UI, audit explorer | Submitted/Returned persist per user |
| Official cert / CardFlow-as-grader / casecomp or tcg-oracle source | Photo estimate + PokeTrace only; see [GRADING_PREPARE_TASKS.md](./GRADING_PREPARE_TASKS.md) |
| `listed` / `sold` / publish / scrape / auto-bid | [NON_GOALS.md](./NON_GOALS.md) |
| Extra currencies, bid UI | Do not build |

---

## Definition of done (this file)

- [x] API restart does not wipe drafts or Max Buy prefs (Phases 1–2). Collection durability after Phase 5 is PokéCollector + CardFlow together.
- [x] CRM writes are request-scoped to an invited session. Invite codes exist. No Apple/Google wall.
- [x] Scan stills persist as first-party `image_storage_ref` and are never catalog art.
- [x] Public TCGdex catalog is flag-gated, English GET only, pricing stripped **on that adapter**. Confirmed cards can read CRM cache if that adapter is down.
- [x] Capture still identify: YOLO11 Nano OBB + RGB pHash vs English TCGdex art. Confirm + manual search. No CardSight. No Pocket catalog.
- [x] PokéCollector is catalog/price/collection/portfolio SoR over HTTP. No AGPL source in this repo. Estimates are USD and honest.
- [x] Livestream: scanner ON → live video → YOLO + card-identity → `tcgdex_id` → PokéCollector estimate. No screenshot. No Capture detour. No inventory write from a guess.
- [x] `cardflow_card_id` / `tcgdex_id` / `cardsight_card_id` stay three IDs. Scan or overlay guess alone does not create inventory.
- [x] Listing Copy still omits notes. Marketplace automation stays OFF.
- [x] `pnpm test` and `pnpm typecheck` pass without vendor keys or PokéCollector.
