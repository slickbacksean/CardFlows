# Remaining tasks

**Written:** 2026-10-01. This is the single open checklist after [ROADMAP.md](./ROADMAP.md). Do the tasks in order. Check a box only when its “Done when” line is true.

This file supersedes the open boxes in [REMAINING_WORKFLOWS.md](./REMAINING_WORKFLOWS.md), [LIVE_IDENTITY_OPENCLIP_TASKS.md](./LIVE_IDENTITY_OPENCLIP_TASKS.md) phases C–F, and the unchecked manual lines in [RUNTIME_CONFIG_TASKS.md](./RUNTIME_CONFIG_TASKS.md). Do not rewrite [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md).

```sh
pnpm test
pnpm typecheck
```

`pnpm test` and `pnpm typecheck` pass on mocks. They do not prove a phone, a live show, or a real grade.

---

## Roadmap status

| Step | Status |
|------|--------|
| 1. Wireframes | Met. [WIREFRAMES.md](./WIREFRAMES.md), [WIREFRAME_TASKS.md](./WIREFRAME_TASKS.md) checked. |
| 2. Implement frames | Met. Phase A–D routes are in the app. |
| 3. Still-image capture | Met. Camera and library stills exist. Identify is OBB + pHash when the local flag is on. Flag off outside tests is no-match. Tests stay on mock. |
| 4. Preferences + Settings | Met. Max Buy GET/PATCH, About, invite switching. No Apple/Google wall. The unchecked definition-of-done boxes at the bottom of [PREFERENCES_SETTINGS_TASKS.md](./PREFERENCES_SETTINGS_TASKS.md) are stale; the tasks above them are checked. |
| 5. Device runtime | Architecture is in. Every box in [DEVICE_RUNTIME_TASKS.md](./DEVICE_RUNTIME_TASKS.md) is checked. Livestream on a real show is not proven. OpenCLIP phases C–F are open. |
| 6. Do not build | Still in force. See the last section of this file. |

The “Done” blurb at the top of [ROADMAP.md](./ROADMAP.md) is stale. Capture is no longer mock-only when `CARD_FLOW_OBB_PHASH_ENABLED=true`. The livestream tab is more than a Confirm leftover, and that leftover path is still rejected.

**Already closed (do not redo):** money parser (`parseDollarsToCents` rejects `1.2.`, `$5`, `12,50`, `abc`, and negatives with 400, nothing stored); invite sessions (`POST /v1/sessions` and `PATCH /v1/identity` require an invite code; auto-session only when `CARD_FLOW_DEV_AUTO_SESSION=true`); OpenCLIP phases A–B, including accept threshold B2 (the unchecked B2 line in [LIVE_IDENTITY_OPENCLIP_STEPS.md](./LIVE_IDENTITY_OPENCLIP_STEPS.md) is stale).

**Already on this machine (not new work):** gitignored YOLO weights, English pHash index, SQLite, OpenCLIP URL and visual index, PokéCollector URL, Claude grade key and workspace id, PokeTrace key and URL, mobile `EXPO_PUBLIC_API_URL`. Leave empty on purpose: CardSight key, live-identity ONNX path, PSA sidecar URL (Claude is the grade path while that URL is unset), invite codes are now required in env (`CARD_FLOW_INVITE_ALEX`, `CARD_FLOW_INVITE_JORDAN`; no built-in defaults, invites fail closed).

---

## P0 — Stop the app from lying, then prove the phone loop

### P0-1 — No mock Pikachu outside tests

- [x] Done.

Outside tests, an unconfigured recognizer returns no-match (“Could not identify” + Search manually), never a fixture. Accept `scenario` only in dev. Do not post an empty web camera scan. If the live catalog is down, Confirm says “Catalog unavailable, try again” instead of looking the card up in `MOCK_CARDS`.

Touch: [apps/api/src/recognition-env.ts](../apps/api/src/recognition-env.ts), Capture scan post, catalog fallback.

**Done when:** Flag off, or a JSON scan with no image, does not name Pikachu. Tests still use mock recognition. `pnpm test` and `pnpm typecheck` pass.

### P0-2 — No mock grade outside tests

- [x] Done.

Default grade estimate is `off` outside tests. Missing PSA URL and missing Anthropic key stay `off`, not mock “Estimate 8.5.” The sheet says “Estimate unavailable.” This machine already has Claude configured, so a configured local API may still return a vision estimate.

Touch: [apps/api/src/grade-estimate-env.ts](../apps/api/src/grade-estimate-env.ts), Prepare sheet.

**Done when:** A boot with the grade flag unset shows no numeric estimate. CI stays on the test mock. `pnpm test` passes.

### P0-3 — Health tells the truth

- [x] Done.

`GET /health` sets `mock: true` if any provider is still mock, and lists which ones. Human labels for recognition, grade estimate, and slab comps. “Checking…” in Settings until health loads. Never leak tokens.

Touch: [apps/api/src/app.ts](../apps/api/src/app.ts), Settings health rows.

**Done when:** Flag-off recognition or a mock grade makes `mock: true`. A fully live local boot can show `mock: false` with readable labels.

### P0-4 — Phone CRM write

- [x] Done.

On a physical phone against `EXPO_PUBLIC_API_URL`: one messy English still → Confirm → Max Buy → Purchased. Restart the API. Collection still shows the copy. The tile’s USD figure is a PokéCollector estimate, not the draft asking price. Confirm is still required. Copy omits notes. USD only.

**Done when:** That write survives an API restart. Simulator success does not count.

---

## P1 — Livestream (unmet roadmap benchmark)

Do not treat a Capture Confirm as a live identify. Guesses do not write inventory. No page screenshot, no `/v1/scans`, no phone camera as the product, no PokéCollector Gemini.

### P1-1 — Overlay shows live guesses only

- [x] Done.

Remove `setLivestreamOverlayCard` from Confirm and `patchLivestreamOverlayCard` from Decide. Scanner OFF does not fill the HUD from a leftover Confirm.

Touch: [apps/mobile/app/scan/[scanId].tsx](../apps/mobile/app/scan/[scanId].tsx), [apps/mobile/app/decide/[cardflowCardId].tsx](../apps/mobile/app/decide/[cardflowCardId].tsx).

**Done when:** Confirming a still does not change the livestream overlay. `pnpm test` still forbids view-shot and `/capture` on the livestream tab.

### P1-3 — Real frames, not page pixels

- [ ] Done.

iOS `AVPlayer` swizzle may never see Whatnot or eBay HLS, because WebKit plays video out of process. The IOSurface page-pixel fallback is removed (2026-10-03). Frames copy only from an `AVPlayer` inside the livestream page. On a device, confirm whether any in-stream player is captured. If none, take frames from a native player for the HLS URL the in-app browser exposes. Android `PixelCopy` may return black frames; same smoke. Device smoke waits on the Apple Developer build.

**Code (2026-10-04):** The in-app browser reports an https `.m3u8` URL (WebView message and Capgo `messageFromWebview`). While the scanner is on, frames still come from an in-page `AVPlayer` or Android video surface when that surface has real pixels. If none is captured, or Android `PixelCopy` is blank, a muted native player (`AVPlayer` / `MediaPlayer`) decodes that playlist and `pullSampleBuffer` copies those frames. The `AVPlayer` hook records players only during a scanner session, and only when the player sits in the livestream page. Device smoke is still open.

**Done when:** Scanner ON on a live show, a card filling the frame: `cardDetected: true` and the API receives `identityCropJpeg` or `identityHash`. No view-shot. No `/capture`.

### P1-4 — ORB re-rank, then measure

- [x] Done.

OpenCLIP on combined live degradations is about 6% correct (eval 2026-09-30). Same-art reprints (Base vs Base 4) near-tie. After P1-3, re-rank HNSW top-K with ORB inliers. Fail-soft to cosine-only if ORB or the reference image is missing. OCR stays deferred unless upright cards still miss. Record identify p50/p95. Drop frames instead of queuing. Target poll ~250 ms and OpenCLIP p95 under 400 ms, or write the honest slower number and lower the poll rate.

Touch: `services/live-identity-openclip/serve.py`.

**Founder note (2026-10-03):** ORB re-rank runs only on a cosine near-tie. A synthetic fixture moves the wrong cosine top to the matching card. Local `base1-36` vs `base4-51` does the same (464 vs 172 inliers). Missing reference images stay cosine-only. OCR stays deferred. Warm matches on MPS: cosine-only p50 about 630 ms, ORB near-tie p50 about 720 ms. First call after boot is about 2.0–2.6 s, so `/health` p95 stays near 1.8 s until that sample leaves the 64-call window. That misses the 400 ms target. Livestream poll is 800 ms, and `pollInFlight` still drops a frame instead of queueing it. The WebView is not blocked on identify.

**Done when:** A fixed near-tie fixture improves, smoke still works without reference images, and a founder note records the measured latency. The HUD does not stutter the WebView.

### P1-5 — Fail-soft matrix and health

- [ ] Done.

| Condition | Expected |
|-----------|----------|
| Scanner OFF | Never a live identity |
| Scanner ON, no card | “Looking…” / unidentified, no inventory row |
| Sidecar down | pHash or unidentified, no crash |
| Index missing | Unidentified, no crash |
| Whatnot ↔ eBay | Remount, no screenshot path |
| Web | “Livestream works in the iOS and Android app.” |

Optional `liveIdentityVisual`: `openclip` \| `phash` \| `off` on `/health`. No token. Update the livestream row in [RUNTIME_CONFIG_PRIORITY.md](./RUNTIME_CONFIG_PRIORITY.md).

**Code (2026-10-03):** `/health` and Settings show `liveIdentityVisual`. Sidecar miss falls through to pHash. Missing index stays unidentified. Web copy uses the sentence above. Phone verification of the matrix is still open.

**Done when:** The matrix is verified on one iPhone. Android can follow. An operator can tell OpenCLIP from pHash without reading only the boot log.

---

## P2 — CRM correctness

### P2-1 — PokéCollector-only rows

- [x] Done.

Remote-only rows use ids like `pc:purchased:…` and an empty `cardflowCardId`. Purchased tap → draft 404. Watchlist tap → “Card not found.” The same rows fail in Grading Prepare. Tiles can have no name or art. `createdAt` changes every request.

On first sight, import the remote copy into SQLite with a stable id and a catalog card. Until that ships, mark the row read-only and hide Draft and Prepare.

**Founder note (2026-10-03):** Remote-only rows stay out of SQLite. They are `readOnly`, Draft and Prepare are hidden, and `createdAt` is fixed. A catalog lookup still fills the tile name and art when the card is known.

**Done when:** A PokéCollector-only purchased card opens a draft, or Draft and Prepare are hidden and the row does not 404.

### P2-2 — One copy per confirmation

- [x] Done.

Confirming the same scan twice, or saving Purchased twice, creates two copies (and two PokéCollector rows). If the scan is already `identity_confirmed`, return that confirmation. One inventory row per confirmation unless the user asks for another copy. Optional `Idempotency-Key` on Purchased and Watchlist.

Validate purchase price, shipping, tax, fees, supplies, and reference price before `writePokecollectorCopy` (the dollar parser already 400s bad money; keep the remote write after that check).

**Founder note (2026-10-04):** A second Confirm on an `identity_confirmed` scan returns the existing confirmation. A second Purchased or Watchlist on that confirmation returns the existing row and does not write PokéCollector again. `anotherCopy: true` is the extra copy. `Idempotency-Key` replays that extra copy. Bad purchase, shipping, tax, fees, supplies, reference, and max-buy amounts return 400 before the remote write.

**Done when:** A second Purchased on the same confirmation returns the existing row. A bad price never creates a PokéCollector card that CardFlow does not have.

### P2-3 — Max Buy factors and Watchlist condition

- [x] Done.

`conditionAdjustments` must be finite numbers ≥ 0. Clean bad rows already stored. Decide must not hardcode NM while Watchlist saves with no condition.

Touch: `maxBuyPreferencesRangeError`, Decide, Watchlist save.

**Founder note (2026-10-04):** `{ NM: -5, LP: "x" }` is rejected. A stored map like that is rewritten to drop every factor that is not a finite number ≥ 0. Decide shows NM / LP / MP / HP / DMG, and Watchlist saves that condition so the tile recomputes the same Max Buy. Reset still fills the defaults and persists only on Save. USD only.

**Done when:** `{ NM: -5, LP: "x" }` is rejected. Reset + Save still restores defaults. The Watchlist tile matches the condition Decide showed. USD only. `pnpm test` passes.

### P2-4 — Grading saves

- [x] Done.

Submit, mark-returned, and edits must keep the previous UI state and restore it when the request fails. Move Submitted → Returned in one SQLite transaction (do not delete the submitted row before the returned insert commits). Cache the photo estimate by inventory item + photo hash. Call Claude or the CNN only when photos change or the user taps Re-estimate.

Manual, after the code change: one purchased copy, front and back, Prepare shows an estimate (Claude on this machine). Restart the API. Submitted still shows that note as guidance history. Returned grade is only what the tester types. Front-only or provider down stays empty, and Move to Submitted still works.

**Founder note (2026-10-04):** A failed submit, mark-returned, or edit restores the previous lists and shows the error. Submitted → Returned is one SQLite transaction, so a failed insert leaves the submitted row. The same photos reuse the cached estimate. Re-estimate, or a new photo, calls the provider again.

**Done when:** A failed submit does not stick in the UI. A successful move survives reload. A second open of Prepare with the same photos does not call the provider again.

---

## P3 — Polish

### P3-1 — Errors, timeout, unknown routes

- [x] Done.

Network errors say “Can’t reach CardFlow,” not “start the mock API.” Map HTTP status codes. `AbortController` around 15 seconds. Dev hint only under `__DEV__`. Root error boundary with “Try again” and a link to Collection. Unknown routes redirect to Collection.

**Founder note (2026-10-04):** A failed request says “Can't reach CardFlow.” A non-JSON 500 is mapped to a status message, so it does not surface a JSON parse error. Calls abort at 15 seconds. The dev URL is appended only under `__DEV__`. The root error boundary offers “Try again” and a Collection link. An unknown route redirects to Collection.

**Done when:** Airplane mode and a 500 do not surface a JSON parse error. A bad route lands on Collection.

### P3-2 — API hardening

- [x] Done.

Allow-list `CARD_FLOW_CORS_ORIGINS` (native apps do not need CORS). Honor `EXPO_PUBLIC_API_URL` on web; loopback override only for dev simulators. Check JPEG, PNG, or WebP magic bytes before saving an upload. Cap livestream identify around 1 MB and other JSON routes around 64 KB. Reject actually sets `identity_rejected`. Label `ready_for_review` in the UI instead of the raw state.

**Founder note (2026-10-04):** `CARD_FLOW_CORS_ORIGINS` is the browser allow list; an empty list echoes no origin. Web uses `EXPO_PUBLIC_API_URL`. A dev simulator still uses loopback. JPEG, PNG, and WebP uploads must match their magic bytes. Livestream identify is capped at 1 MB and other JSON routes at 64 KB. Reject sets `identity_rejected` and writes no inventory. Export shows “Ready for review.”

**Done when:** A non-image upload is rejected. An oversized identify body is rejected. Tests cover the reject state and the body limit.

### P3-3 — Chrome

- [x] Done.

Hide the header bell. Hide disabled Shop “Supplies · Later” and Export “CSV” / “Publish” rows so they do not look broken. Delete unused `placeholder-screen`, `tab-wireframe`, and Expo template logos. Set iOS `userInterfaceStyle` to `dark`, or add a light palette. Collection shows a spinner while the session loads, and hides “0 purchased · 0 watching” until data arrives. Desktop web collection uses column count from `useWindowDimensions`. HUD WebView `originWhitelist` is the HUD origin only. Open the in-app browser from one path. Poll HUD health only while the livestream tab is focused and the scanner is on. Fix the `react-hooks/set-state-in-effect` lint on Capture, Decide, draft, and the sheets (remount with a `key`, or seed state from props).

**Founder note (2026-10-04):** The header bell is gone. Shop no longer shows Supplies, and Export no longer shows CSV or Publish. Template screens and React logos are deleted. `userInterfaceStyle` is `dark`. Collection shows a spinner and hides the purchased/watching counts until the session loads. The grid column count follows the window width. The HUD WebView allows only the HUD origin. The in-app browser opens from the layout effect. HUD health polls only while the livestream tab is focused and the scanner is on. Capture, Decide, draft, and the sheets no longer set state synchronously inside effects. Mobile lint is clean on those files.

**Done when:** Those surfaces no longer show no-op or template chrome. Mobile lint is clean on those files.

### P3-4 — CI

- [x] Done.

GitHub Action: `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, mobile lint. No vendor keys, no ONNX, no `.pth` in the workflow.

**Founder note (2026-10-04):** `.github/workflows/ci.yml` runs on pull requests. It installs with `pnpm install --frozen-lockfile`, then runs `pnpm test`, `pnpm typecheck`, and `pnpm --filter @cardflow/mobile lint`. The job reads no secrets and does not fetch ONNX or `.pth` files.

**Done when:** A pull request runs that workflow without secrets.

---

## Last — Apple Developer Program

Buy this membership after the other open tasks. Local Xcode 15.2 cannot build the dev client.

### P1-2 — Native dev client

- [ ] Done.

Expo Go cannot load `cardflow-live-video`. Local `expo run:ios` needs Xcode ≥ 16.1; this Mac has Xcode 15.2. Install the EAS development build already chosen in [LIVE_IDENTITY_OPENCLIP_TASKS.md](./LIVE_IDENTITY_OPENCLIP_TASKS.md) (needs Apple Developer Program membership). Capgo stays out of the binary; the tab uses `react-native-webview`.

**Done when:** On the installed app, `isLiveVideoNativeAvailable()` is true. Scanner is not permanently “unavailable.”

---

## Later (not this pass)

- [ ] Replace the smoke `phase2_best.pth` with a trained checkpoint, then re-check Prepare before trusting the number. Claude remains the usable interim while the PSA URL is unset.
- [ ] PokeTrace Pro: one known `tcgdex_id` shows a real PSA / BGS / CGC / TAG amount. Until then, keep graded rows hidden. Do not call `/prices/{tier}/history` on the Free plan (`403 UPGRADE_REQUIRED`).
- [ ] Shop supplies checkout.
- [ ] Export CSV.
- [ ] Notifications for the header bell.
- [ ] `preview` and `production` EAS profiles, and a compiled API (`node` instead of `tsx`) when you leave local dev.

---

## Do not build

- Screenshot or still-capture of the livestream as the identify path.
- CardSight HTTP for Capture or the livestream tab.
- Phone-camera continuous identify.
- Workflow states `listed`, `sold`, `shipped`, `paid_out`.
- Marketplace publish, scraping, auto-bid, account automation.
- Other TCGs, languages, or sports.
- Official grading certs or CardFlow-as-PSA.
- Vendoring casecomp, tcg-oracle, pokemon-scanner, or PokéCollector source.
- Running `tcgdex/server`. Copying `pricing` onto listing drafts.
- PokéCollector Gemini.

---

## Test order

1. After P0 code: `pnpm test` and `pnpm typecheck`. Then P0-4 on the phone.
2. After P1-1: `pnpm test`. Device proof waits until the Apple Developer build (last section) and P1-3.
3. After P1-4: latency note plus the P1-5 matrix on one iPhone.
4. After each P2 task: the CRM loop still completes (scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy), then restart the API and confirm the copy is still there.
5. P3-4 is the ongoing check. It does not replace the phone tests.
