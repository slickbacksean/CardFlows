# Remaining workflows

**Written:** 2026-10-01. This is the work still open after [DEVICE_RUNTIME_TASKS.md](./DEVICE_RUNTIME_TASKS.md). Source of the bugs: [WORKFLOW_REVIEW_ISSUES.md](./WORKFLOW_REVIEW_ISSUES.md) (2026-09-30), minus items closed since then. Livestream identity gaps: [LIVE_IDENTITY_OPENCLIP_TASKS.md](./LIVE_IDENTITY_OPENCLIP_TASKS.md) Phases C–F.

`pnpm test` and `pnpm typecheck` pass. That does not mean these workflows are done on a phone.

## Already closed (do not redo)

- Typecheck failure in `live-identity-openclip.test.ts` (was P2-1).
- PokeTrace missing-key mock of “PSA 10 · $120” (was P1-3). Prepare now shows Free-plan raw NM / LP / MP / HP / DMG, or `—`.
- About placeholder sentence (was the About part of P3-2). Copy is the reserved §10b line.
- Capture still → OBB crop → English pHash → Confirm, on a **local** API with weights and the gitignored index.
- Overlay guess does not write inventory. Web livestream stays “Scanner unavailable.”

## Not a product feature (do not build in this pass)

| Asked for | What the product actually is |
|-----------|------------------------------|
| Bulk upload | One still at a time. [LISTING_EXPORT_AND_COPY.md](./LISTING_EXPORT_AND_COPY.md) says do not bulk-upload photos to venues. |
| Export CSV | Explicitly not private beta. |
| Shop Supplies checkout | Stub (“Supplies · Later”). |
| Header bell | No-op by plan. Hide it (P3-2); do not invent notifications. |
| `listed` / `sold` / publish / auto-bid | [NON_GOALS.md](./NON_GOALS.md). |
| Graded slab comps (PSA / BGS / CGC / TAG) | Needs a paid PokeTrace plan. Mapping exists; Prepare hides empty graded rows. |

---

## 1. Listing draft and Copy

**Status:** The happy path works (title, condition, asking price, Copy omits notes, USD only). Typing a bad price crashes the screen, and a bad save can make the draft unloadable forever.

| Problem | Solution |
|---------|----------|
| Draft screen throws while typing `1.2.`, `.`, `12,50`, or `$5` because `dollarsToCents` runs during render. No error boundary, so the screen dies. (P0-1) | Add `parseDollarsToCents(value): number \| null`. Accept a leading `$` and a comma decimal. Treat invalid text as “missing,” with inline “Enter a valid price.” |
| `Math.round(usd * 100)` turns $1.005 into $1.00. (P3-6) | Parse dollars and cents from the string in that same helper. |
| `PATCH` asking price `"abc"` returns 500 **after** the bad value is saved. Later GETs also 500. (P0-2) | Validate with zod before any write. 400 with a field error. Repair stored drafts whose `asking_price` is not numeric. |
| Malformed JSON (`{bad`) is a plain-text 500. (P2-5) | `app.onError` returns `{ ok: false, error }`. Syntax and zod errors are 400. |

---

## 2. Purchased, Watchlist, and Max Buy

**Status:** Confirm → Max Buy → Purchased or Watchlist works when the price is a normal number. Bad money, repeats, and condition factors corrupt the numbers.

| Problem | Solution |
|---------|----------|
| `purchasePrice: "abc"` is HTTP 500. With PokéCollector on, the remote copy is written **before** local math throws, so PokéCollector has a card CardFlow does not. (P0-2) | Validate purchase price, shipping, tax, fees, supplies, and reference price **before** `writePokecollectorCopy`. |
| `POST /v1/max-buy` with `referencePriceAmount: "abc"` is 500. (P0-2) | Same parser. 400, nothing stored. |
| Negative purchase price (`-50`) and `purchasedAt: "not-a-date"` are accepted. Decide accepts a negative reference price. (P1-9) | Reject amounts below 0. Validate `purchasedAt` with `z.iso.datetime()`. |
| `conditionAdjustments` of `{ NM: -5, LP: "x" }` saves. Max Buy then shows `$NaN` or `-$348`. (P1-9) | Extend `maxBuyPreferencesRangeError` so every factor is a finite number ≥ 0. Clean bad rows already stored. |
| Confirming the same scan twice, or saving Purchased twice, creates two copies (and two PokéCollector rows on a retry). (P2-4) | If the scan is already `identity_confirmed`, return that confirmation. One inventory row per confirmation unless the user asks for another copy. Optional `Idempotency-Key` on Purchased and Watchlist. |
| Decide shows Max Buy with hardcoded condition `NM`. Watchlist saves with no condition, so the tile can disagree. (P2-6) | Send the same condition on the Watchlist save, or stop hardcoding NM on Decide. |

---

## 3. Capture still identify

**Status:** Works locally when `CARD_FLOW_OBB_PHASH_ENABLED`, the ONNX path, and the English pHash index are set. The **default** config still names every photo Pikachu.

| Problem | Solution |
|---------|----------|
| Flag off, or a JSON scan with no image, returns mock Pikachu even when live identify is on. Release builds still send `scenario`. Web shutter posts a scan with no image. (P1-1) | Outside tests, an unconfigured recognizer returns no-match (“Could not identify” + Search manually), never a fixture. Accept `scenario` only in dev. Do not post an empty web camera scan. |
| If the live catalog is down, Confirm looks the card up in `MOCK_CARDS`. (P2-7) | Mock lookup only when tests pass an explicit option. Otherwise “Catalog unavailable, try again.” |
| Physical-phone camera → OBB → pHash has not been re-checked in this pass. | One messy English still on a device dev client. Confirm still required. |

---

## 4. Collection and card tracking

**Status:** Cards created in CardFlow open, draft, and show all-in cost. Cards that exist only in PokéCollector do not.

| Problem | Solution |
|---------|----------|
| Remote-only rows use ids like `pc:purchased:…` and an empty `cardflowCardId`. Purchased tap → draft 404. Watchlist tap → `/decide/` “Card not found.” Same rows fail in Grading Prepare. Tiles can have no name or art. `createdAt` changes every request. (P1-6) | On first sight, import the remote copy into SQLite with a stable id and a catalog card. Until that ships, mark the row read-only and hide Draft and Prepare. |
| First paint shows “0 purchased · 0 watching” for several seconds while the session restores. (P3-3) | Spinner while `loadState === "loading"`. Hide counts until data arrives. |
| Desktop web grid is two columns of oversized tiles. (P3-4) | Column count from `useWindowDimensions`. |

---

## 5. Livestream, in-app browser, and overlay HUD

**Status:** The contract is in code (in-stream `live_video`, two-hit stabilize, guess does not write inventory, web stays unavailable). A real Whatnot or eBay show is **not** proven. OpenCLIP live recall on degraded crops is about 6% correct at the current gate. Phases C–F of [LIVE_IDENTITY_OPENCLIP_TASKS.md](./LIVE_IDENTITY_OPENCLIP_TASKS.md) are open.

| Problem | Solution |
|---------|----------|
| iOS `AVPlayer` swizzle likely never sees Whatnot/eBay HLS (WebKit plays video out of process). IOSurface fallback reads **page pixels**, which the roadmap forbids. The swizzle patches `AVPlayer.play` for the whole app. (P1-5) | Remove the IOSurface fallback. On a device, confirm whether any player is captured. If none, take frames from a native player for the HLS URL the in-app browser exposes. Scope any hook to the livestream session. |
| Android `PixelCopy` may return black frames. | Same device smoke: `cardDetected: true` and a non-null crop or hash while a card fills the show. ([LIVE_IDENTITY_OPENCLIP_TASKS.md](./LIVE_IDENTITY_OPENCLIP_TASKS.md) D1–D3.) |
| No installed dev client yet (`expo-dev-client` is added; Expo Go cannot load the native module). (D1–D2) | `npx expo run:ios --device` (Xcode ≥ 16.1) or an EAS development build. `isLiveVideoNativeAvailable()` must be true. |
| Overlay still fills from Capture Confirm (“leftover”), a path the roadmap rejected. (P1-4) | Remove `setLivestreamOverlayCard` / `patchLivestreamOverlayCard` from Capture and Decide. Overlay shows live guesses only. |
| OpenCLIP on combined live degradations is ~6% correct. Same-art reprints (Base vs Base 4) near-tie. (eval 2026-09-30) | Ship a dev client and measure real crops first (D3, E1). Then ORB re-rank of HNSW top-K for same-Pokémon / different-set ties (C1). OCR only if upright cards still miss (C2, may stay deferred). |
| Two stable hits → name + estimate + Max Buy on the HUD is not confirmed on a phone. (E1–E3) | Scanner OFF: no live identity. Scanner ON, no card: “Looking…”. Sidecar down: pHash or unidentified, no crash. Whatnot ↔ eBay remounts without a screenshot. Record identify p50/p95; drop frames instead of queuing. |
| In-app browser opens twice (`useEffect` and `onLayout`). HUD health polls every 4s even when the tab is not focused. (P2-13) | Open from one path. Poll only while the tab is focused and the scanner is on. |
| HUD WebView is HTTP and allows any origin. (P3-8) | `originWhitelist` is the HUD origin only. HTTPS or a bundled HTML file. |
| Web livestream region is a blank area. (P3-4) | “Livestream works in the iOS and Android app.” |
| `/health` does not say whether identity is OpenCLIP, pHash, or off. (F1–F2) | Optional `liveIdentityVisual` with no token. Update the runtime priority table. |

---

## 6. Grading (Prepare, Submitted, Returned)

**Status:** Photo estimate and Free-plan raw comps work when those providers are configured. Submit can lie to the user. Graded comps are later.

| Problem | Solution |
|---------|----------|
| Default config (flag off, or flag on with no CNN URL and no vision key) returns a fake “Estimate 8.5.” The sheet does not say it is mock. (P1-2) | Default to `off` outside tests. Missing credentials stay `off`, not mock. UI: “Estimate unavailable.” |
| Every time Prepare opens, it re-runs the estimator. With vision, that is a paid call even if the photos did not change. (P2-12) | Cache by inventory item + photo hash. Call the provider only when photos change or the user taps Re-estimate. |
| Submit, mark-returned, and edits update the UI first and swallow errors (`.catch(() => {})`). Refresh snaps the row back. Server deletes the submitted row before inserting returned, with no transaction. (P1-7) | Keep previous state and restore it on error. One SQLite transaction for the move. |
| Graded PSA / BGS / CGC / TAG amounts are empty on the Free plan. | Leave hidden until a Pro key exists. Do not call `/prices/{tier}/history`. |
| Prepare front+back smoke and Claude paths are not re-checked in the app. | Manual: one purchased copy, front and back, after API restart. ([RUNTIME_CONFIG_TASKS.md](./RUNTIME_CONFIG_TASKS.md).) |
| Trained grade weights are still the smoke checkpoint. | Install `phase2_best.pth` and re-check Prepare before trusting the number. |

---

## 7. Catalog, Shop, and market data

**Status:** Local stack uses PokéCollector for catalog and USD estimates. Drafts still must not receive `pricing`. Shop supplies and CSV are stubs.

| Problem | Solution |
|---------|----------|
| Settings shows raw ids (`obb_phash`, `yolo_identity`, `pokecollector`) and hides grade and slab mode. `mock: false` while recognition or grading is still mock. Before health loads, every row says “unavailable.” (P2-8, P3-1) | `mock: true` if any provider is mock, plus `mockProviders`. Human labels. Rows for grade estimate and slab comps. “Checking…” until health loads. |
| Shop “Supplies · Later”, Export “CSV · not in private beta”, “Publish · no”. | Leave as later. Hide the disabled rows so they do not look broken (P3-2). |
| Collection/pricing after an API restart is not re-checked on the phone. | One spot-check: a purchased tile shows a USD estimate from PokéCollector, not a draft price. |

---

## 8. Identity, sessions, and Settings

**Status:** Invite codes stay on the server. Auto-session is off unless `CARD_FLOW_DEV_AUTO_SESSION=true`. The app asks for a code before Collection, Settings shows only the current tester, and the web token is stored in `localStorage`.

| Problem | Solution |
|---------|----------|
| `PATCH /v1/identity` with another tester’s id returns a bearer token. No invite code and no existing token, because dev auto-session is on unless `NODE_ENV=production`. `pnpm start` does not set that. (P0-3) | Require `inviteCode` (or delete this route and use `POST /v1/sessions` only). Auto-session only when `CARD_FLOW_DEV_AUTO_SESSION=true`. Log a warning when it is on. |
| `alex-beta` and `jordan-beta` ship inside the app. With no stored token the app redeems Alex, so every install shares one inventory. Web keeps the token in memory only, so reload is Alex again. (P0-4) | Tester list on the server, loaded from env, not `@cardflow/shared`. “Enter invite code” instead of auto-redeem. Settings shows only the current tester. Persist the web token. |
| Max Buy rules screen can save bad factors (see workflow 2). | Same validation as P1-9. Reset + Save still restores defaults. USD only. |

---

## 9. Cross-cutting (every screen that calls the API)

| Problem | Solution |
|---------|----------|
| Network errors say “start the mock API.” A text 500 becomes a JSON parse error. No request timeout. (P1-8) | Friendly “Can’t reach CardFlow.” Map status codes. `AbortController` ~15s. Dev hint only under `__DEV__`. |
| No root `ErrorBoundary`, no `+not-found` route. (P2-9) | “Try again” and a link to Collection. Unknown routes redirect to Collection. |
| App defaults to `http://127.0.0.1:3001` and **ignores** `EXPO_PUBLIC_API_URL` on web and simulators. EAS is development-only. API `start` is `tsx`. (P2-10) | Honor `EXPO_PUBLIC_API_URL`. Loopback override only for dev simulators. HTTPS outside dev. `preview` and `production` EAS profiles. Run a compiled API with `node`. |
| CORS allows every origin. (P2-11) | Allow-list `CARD_FLOW_CORS_ORIGINS`. Native apps do not need CORS. |
| No CI. (P2-3) | GitHub Action: `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, mobile lint. |
| 11 `react-hooks/set-state-in-effect` lint errors on Capture, Decide, draft, and the sheets. (P2-2) | Remount sheets with a `key`, or seed state from props. |
| Uploaded type is trusted from the header or extension. (P3-7) | Magic bytes for JPEG, PNG, or WebP before save. |
| Reject copy claims the scan is discarded; the server does not mark `identity_rejected`. “IDs stay separate.” Export shows raw `ready_for_review`. (P3-1) | Label map. Reject actually sets `identity_rejected`. |
| Notifications bell, unused `placeholder-screen` / `tab-wireframe`, Expo template logos. (P3-2) | Hide the bell. Delete unused components and template images. |
| iOS `userInterfaceStyle` is `automatic` while the palette is dark only. (P3-5) | Set `userInterfaceStyle` to `dark`, or add a light palette. |
| Livestream identify accepts up to ~8 MB of base64, about four times a second, with no body limit. (P2-5) | ~1 MB on identify, ~64 KB on other JSON routes. |

---

## Order to implement

1. Money parser (workflows 1–2): stops the draft crash, the 500s, NaN Max Buy, and PokéCollector writing a copy CardFlow does not have.
2. Sessions (workflow 8) — done. Invite codes stay on the server; the app asks for a code instead of redeeming Alex.
3. No mock recognition or mock grade outside tests (workflows 3 and 6), and health that says when a mock is on (workflow 7).
4. Livestream on a real device (workflow 5): native build, prove frames, then ORB. Do not treat leftover Confirm as live identity.
5. Collection import for PokéCollector-only rows, idempotent Purchased, grading transactions, then the P2/P3 polish.
