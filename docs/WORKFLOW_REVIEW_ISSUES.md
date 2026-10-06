# CardFlow workflow review: issues and fixes

**Reviewed:** 2026-09-30. Every workflow in `apps/mobile`, `apps/api`, and `packages/shared` was checked against [ROADMAP.md](./ROADMAP.md), [NON_GOALS.md](./NON_GOALS.md), and [WIREFRAMES.md](./WIREFRAMES.md). No code was changed while writing this report.

## Summary

| Priority | Count | Meaning |
|----------|-------|---------|
| P0 | 4 | Crash, data corruption, security, or a broken locked rule |
| P1 | 9 | Broken workflow step, or mock data shown in a product path |
| P2 | 13 | Missing error or edge-case handling, tooling gaps, misleading status |
| P3 | 8 | Polish, copy, accessibility, cleanup |

**Workflows covered:** Capture still identify, Confirm or manual search, Decide and Max Buy, Purchased and Watchlist, listing draft and Copy, Collection, Shop, Export, catalog and pricing, Livestream Screener (JS and native modules), Grading (Prepare, Submitted, Returned), Settings and Max Buy rules, identity and sessions, navigation shell, and DB migrations.

**How it was checked:**

- `pnpm install`, `pnpm test`, `pnpm typecheck`, and `expo lint`.
- `drizzle-kit check`.
- Line-by-line reading of every route in `apps/api/src/app.ts` and every screen and sheet in the app.
- A temporary API on port 3999 with every flag blank and an in-memory store. This simulates a fresh deploy. The main loop and each edge case were run against it with curl.
- A read-only click-through of the web build against your local stack. Nothing was saved.

**Baseline results:**

| Check | Result |
|-------|--------|
| `pnpm test` | Pass. 35 files, 183 tests. |
| `pnpm typecheck` | **Fails** in the API, so the mobile `tsc` step never runs. Run on its own, mobile `tsc` passes. |
| `expo lint` (mobile) | **11 errors**, all `react-hooks/set-state-in-effect`. |
| `drizzle-kit check` | Pass. |
| CI | No workflow files exist in `.github/`. |

---

## P0: fix first

### P0-1. The listing draft screen crashes while the user types an asking price

- **Workflow:** Listing draft and Copy.
- **Where:**
  - `apps/mobile/app/draft/[draftId].tsx` lines 131-148
  - `packages/shared/src/listing-draft.ts` lines 95-129
  - `packages/shared/src/money.ts` lines 3-9
- **Observed:** On every render, `computeCostToAskSpread` and `readyForReviewMissing` run on the raw asking-price text. Both call `dollarsToCents`, which **throws** on anything that isn't a number. The `decimal-pad` keypad lets users type `1.2.`, `.`, or (on comma-decimal locales) `12,50`. Pasted text like `$5` also throws. The throw happens during render and the app has no error boundary, so the screen crashes. Verified: all four inputs throw.
- **Expected:** Bad input shows an inline "Enter a valid price" message, and the screen keeps working.
- **Solution:**
  - Add a non-throwing `parseDollarsToCents(value): number | null` in `money.ts`. Accept a comma as the decimal separator and strip a leading `$`.
  - Use it in `computeCostToAskSpread`, `readyForReviewMissing`, and the draft screen, and treat invalid input as "missing".
  - Add a root error boundary (see P2-9).
- **Effort:** S

### P0-2. Bad money input returns HTTP 500, can permanently break a draft, and can leave PokéCollector out of sync

- **Workflow:** Purchased, listing draft, Max Buy.
- **Where:** `apps/api/src/app.ts`:
  - Purchased: lines 1129-1210, with the PokéCollector write at 1165-1171 running before the cost math at 1173
  - Draft PATCH: lines 1309-1327
  - `POST /v1/max-buy`: lines 858-869
  - Draft view: `apps/api/src/listing.ts` line 123
- **Observed (curl against the test API):**
  - `POST /v1/inventory/purchased` with `purchasePrice: "abc"` returns **500**. With PokéCollector enabled, the remote copy is written first and the local write then throws, so the remote has a copy that CardFlow doesn't.
  - `PATCH /v1/drafts/:id` with `askingPrice: "abc"` returns **500**, but the value is **already saved**. Every later `GET /v1/drafts/:id` also returns **500**, so the draft can't be opened again.
  - `POST /v1/max-buy` with `referencePriceAmount: "abc"` returns **500**.
- **Expected:** A 400 with a field error, and nothing written locally or remotely.
- **Solution:**
  - Add zod schemas for every money field (purchase price, shipping, tax, fees, supplies, reference price, asking price), reusing `parseDollarsToCents` from P0-1.
  - Validate before `writePokecollectorCopy` runs.
  - Add `app.onError` to return JSON 400 or 500.
  - Write a one-off script to repair stored drafts whose `asking_price` isn't numeric.
- **Effort:** M

### P0-3. Anyone can get a session for any tester without an invite code

- **Workflow:** Identity and sessions.
- **Where:**
  - `apps/api/src/app.ts` lines 389-407 (auth middleware) and 788-801 (`PATCH /v1/identity`)
  - `apps/api/src/session.ts` lines 51-57
- **Observed:**
  - `PATCH /v1/identity {"userId": "<jordan>"}` returns a fresh bearer token for Jordan. It needs no invite code and **no token at all**, because dev auto-session lets unauthenticated requests through. Verified with curl.
  - Dev auto-session is **on unless `NODE_ENV=production`**, and `pnpm start` (`tsx src/index.ts`) doesn't set `NODE_ENV`.
  - Net effect: an API deployed that way accepts every unauthenticated request as Alex.
- **Expected:** Switching testers requires the target's invite code, and missing auth returns 401 outside local dev.
- **Solution:**
  - Make `PATCH /v1/identity` require `inviteCode`, or remove it and use `POST /v1/sessions` only.
  - Change the dev auto-session default to `false` unless `CARD_FLOW_DEV_AUTO_SESSION=true` is set.
  - Log a startup warning whenever auto-session is on.
- **Effort:** S

### P0-4. Every install shares one hardcoded "mock tester" account, and the invite codes ship in the app

- **Workflow:** Identity, plus every CRM write.
- **Where:**
  - `packages/shared/src/identity.ts` lines 20-43: hardcoded `alex-beta` and `jordan-beta`, commented "the two mock testers"
  - `apps/mobile/lib/identity.ts` lines 60-80 and 116-124
  - `apps/mobile/lib/session-token.ts` lines 6 and 44-58: on web the token is kept only in memory
- **Observed:**
  - The mobile bundle imports every invite code from `@cardflow/shared`.
  - When the app has no stored token, it **automatically redeems Alex's code**. So every real tester lands in the same account and sees and edits the same inventory.
  - On web, the token isn't persisted, so a reload signs back in as Alex.
- **Expected:** One account per tester. Invite codes exist only on the server and are typed in by the user.
- **Solution:**
  - Move the tester list to a server-side file or table loaded from env, kept out of `@cardflow/shared`.
  - Replace the automatic Alex redeem with an "Enter invite code" screen. The private-beta rules allow this; it isn't a sign-up wall.
  - Show only the current tester in Settings.
  - Persist the web token in `localStorage`, or use a cookie.
- **Effort:** M

---

## P1: broken workflow steps and mock data in product paths

### P1-1. Real photos come back as a mock card (Pikachu) under the default config

- **Workflow:** Capture still identify.
- **Where:**
  - `apps/api/src/recognition-env.ts` lines 52-60 and 79-86
  - `apps/api/src/scan-identify.ts` lines 39-55
  - `apps/api/src/app.ts` lines 900-917
  - `apps/mobile/app/capture.tsx` lines 76-81 (always sends `scenario: getMockScenario()`) and line 111 (web shutter posts a scan with no image)
- **Observed:**
  - With `CARD_FLOW_OBB_PHASH_ENABLED` unset (the default), uploading the app icon returned `provider: "mock"`, `_meta.mocked: true`, and "Pikachu Base Set #58, matched".
  - A JSON scan with no image returns the mock card **even when live identify is on**.
  - Release builds still send the dev `scenario` field.
- **Expected:** Outside tests and dev, the API never returns fixture recognition. If identify is unavailable, the scan reports "Could not identify" and offers manual search.
- **Solution:**
  - When OBB isn't configured outside `VITEST` or `NODE_ENV=test`, use an "unavailable" recognition provider that returns a no-match result.
  - Accept `scenario` only when dev auto-session is on.
  - In `capture.tsx`, send `scenario` only under `__DEV__`.
  - On web, don't post an empty camera scan.
- **Effort:** M

### P1-2. The Grading photo estimate is a fixed mock grade under the default config

- **Workflow:** Grading Prepare.
- **Where:**
  - `apps/api/src/grade-estimate-env.ts` lines 44-56: flag unset → mock; flag on without a URL or key → mock
  - `packages/shared/src/grade-estimate.ts` lines 386-397
  - `apps/mobile/components/ui/prepare-sheet.tsx` lines 255-283
- **Observed:** A grade estimate on the app icon (not a card) returned `provider: "mock"` and "Estimate 8.5, medium confidence". With a back photo it says "high confidence". The UI never shows the provider, so users can't tell the grade is fake.
- **Expected:** No estimate unless a real CNN or vision provider is configured.
- **Solution:**
  - Default to `off` outside tests, and fall back to `off`, not `mock`, when the flag is on but credentials are missing.
  - Show "Estimate unavailable" for `off`.
  - Optionally label mock results "DEV sample" under `__DEV__`.
- **Effort:** S

### P1-3. Slab comps show a fake "PSA 10 · $120" for every card when PokeTrace is on without a key

- **Workflow:** Grading Prepare, slab estimate.
- **Where:**
  - `apps/api/src/poketrace-env.ts` lines 42 and 66-68
  - `packages/shared/src/slab-pricing.ts` lines 212-228
- **Observed:** `CARD_FLOW_POKETRACE_ENABLED=true` without `POKETRACE_API_KEY` selects the mock provider. It returns PSA 10 at $120 for every card and labels it "Estimate".
- **Expected:** Fail soft to empty rows, matching the `.env.example` note "Fail soft when off."
- **Solution:** Return `off` when the key is missing. Keep the mock provider for tests only.
- **Effort:** S

### P1-4. The Livestream overlay is still filled by Capture Confirm, a path the roadmap rejected

- **Workflow:** Livestream Screener.
- **Where:**
  - `apps/mobile/app/scan/[scanId].tsx` lines 155-164
  - `apps/mobile/app/decide/[cardflowCardId].tsx` lines 110-116
  - `packages/shared/src/livestream-overlay.ts` lines 25-41 (`"leftover"` kind)
- **Observed:** After a still is confirmed on Capture, the Livestream tab shows that card as the "leftover" overlay. ROADMAP says the "screenshot-then-Capture path is **rejected** for the scanner going forward."
- **Expected:** The overlay shows only live-video guesses.
- **Solution:** Remove `setLivestreamOverlayCard` and `patchLivestreamOverlayCard` from the Capture and Decide screens, and remove the `leftover` kind with its tests.
- **Effort:** S

### P1-5. The iOS live-video module can read WebView page pixels, and its player hook probably never fires

- **Workflow:** Livestream Screener (native).
- **Where:** `apps/mobile/modules/cardflow-live-video/ios/CardFlowLiveVideoModule.swift`:
  - lines 80-85 and 223-254 (`largestLiveVideoSurface` reads `IOSurface` layer contents)
  - lines 417-456 (`AVPlayer` swizzle)
- **Observed:**
  - When no `AVPlayer` is found, the fallback reads WKWebView layer surfaces. That is effectively a still of the page and conflicts with the locked rule "must not identify from a still of the page."
  - WebKit plays HTML5/HLS video out of process, so the in-app `AVPlayer` hook probably never sees Whatnot or eBay video. If so, live identify never produces frames on iOS.
  - The swizzle also changes `AVPlayer.play` for the whole app.
- **Expected:** Frames come only from the stream's video, or the scanner reports "unavailable".
- **Solution:**
  - Remove the IOSurface fallback.
  - Confirm on a device whether any `AVPlayer` is captured. If none is, redesign the frame source (for example, a native player for HLS URLs the in-app browser exposes) before relying on this feature.
  - Scope the swizzle to the livestream session.
- **Effort:** L. Needs device QA.

### P1-6. Collection rows that exist only in PokéCollector can't be opened

- **Workflow:** Collection, Grading, Decide.
- **Where:**
  - `apps/api/src/app.ts` lines 314-354 (`mergeRemoteCopies`)
  - `apps/mobile/app/(tabs)/collection.tsx` lines 98-127
- **Observed:**
  - Remote-only copies get IDs like `pc:purchased:<id>` and `cardflowCardId: ""`.
  - Tapping a purchased row calls `POST /v1/inventory/pc:…/drafts`, which returns 404 "Inventory item not found".
  - Tapping a watchlist row opens `/decide/` with an empty ID, which shows "Card not found".
  - These rows also show up in Grading Prepare and fail the same way.
  - `createdAt` is recomputed on every request.
  - If the card was never cached locally, the tile has no name or art.
- **Expected:** Remote rows either open correctly or are clearly read-only.
- **Solution:**
  - On first sight, import remote copies into the local store as real rows with stable IDs and a canonical card resolved from the catalog.
  - Until then, mark them `readOnly` and hide the draft and Prepare actions.
- **Effort:** M

### P1-7. Grading saves fail silently, and Returned isn't atomic

- **Workflow:** Grading Submitted and Returned.
- **Where:**
  - `apps/mobile/app/(tabs)/grading.tsx` lines 151-206 (`.catch(() => {})` on submit, mark-returned, and both edit paths)
  - `apps/api/src/app.ts` lines 719-731
- **Observed:**
  - The UI updates before the server replies and drops any server error. If a save fails, the copy shows as Submitted or Returned until the next refresh, then silently goes back.
  - On the server, the submitted row is deleted before the returned row is saved, with no transaction. If the second step fails, the copy disappears from both lists.
- **Expected:** Errors are shown and the UI rolls back. The server move is all-or-nothing.
- **Solution:**
  - On the client, keep the previous state, restore it on error, and show the error message.
  - On the server, add a `moveSubmittedToReturned` store method that runs in one SQLite transaction.
- **Effort:** S

### P1-8. Error messages tell users to "start the mock API", and non-JSON errors show a parse error

- **Workflow:** Every screen that calls the API.
- **Where:** `apps/mobile/lib/api.ts` lines 203-219.
- **Observed:**
  - Network failures show: "Cannot reach the mock API at http://127.0.0.1:3001. Start it with pnpm dev:api."
  - When the API returns a plain-text 500, as it does in P0-2, `response.json()` throws and the user sees a raw JSON parse error.
  - Requests have no timeout.
- **Expected:** Plain-language messages ("Can't reach CardFlow. Check your connection.") and a bounded wait.
- **Solution:**
  - Wrap `response.json()` in a try/catch.
  - Map status codes to friendly messages.
  - Add an `AbortController` timeout of about 15 seconds.
  - Show the dev hint only under `__DEV__`.
- **Effort:** S

### P1-9. Invalid values are accepted and shown as NaN or negative money

- **Workflow:** Max Buy rules, Purchased, Decide.
- **Where:**
  - `apps/api/src/app.ts` lines 836-856 (`PATCH /v1/preferences`) and 1145-1158 (Purchased)
  - `packages/shared/src/max-buy.ts` lines 181-191
  - `apps/mobile/app/decide/[cardflowCardId].tsx` lines 359-365
- **Observed (curl):**
  - `conditionAdjustments: {"NM": -5, "LP": "x"}` is accepted and saved. After that, Max Buy for $100 LP shows "**$NaN**" and for NM shows "**-348.00**".
  - Purchased accepts a price of `-50` (all-in `-50.00`) and a `purchasedAt` of `"not-a-date"`.
  - The Decide screen accepts a negative reference price.
- **Expected:** Condition factors are finite numbers of 0 or more, money is 0 or more, and dates are ISO strings.
- **Solution:**
  - Extend `maxBuyPreferencesRangeError` to check `conditionAdjustments`.
  - Reject negative amounts in the shared parser.
  - Validate `purchasedAt` with `z.iso.datetime()`.
  - Clean up stored preferences with bad factors.
- **Effort:** S

---

## P2: edge cases, tooling, and misleading status

### P2-1. `pnpm typecheck` fails

- **Where:** `apps/api/src/live-identity-openclip.test.ts` line 48.
- **Observed:** TS2352 and TS2493 on `fetchImpl.mock.calls[0]?.[1]`. Because this step fails first, the mobile typecheck never runs from the root script.
- **Solution:** Type the mock as `vi.fn<typeof fetch>(...)`, or read `fetchImpl.mock.calls[0] as unknown as [RequestInfo, RequestInit]`.
- **Effort:** S

### P2-2. Mobile lint: 11 `set-state-in-effect` errors

- **Where:**
  - `capture.tsx:59`
  - `decide/[cardflowCardId].tsx:79`
  - `draft/[draftId].tsx:91`
  - `prepare-sheet.tsx:108, 124, 148`
  - `purchase-sheet.tsx:75`
  - `returned-sheet.tsx:51`
  - `screener-overlay.tsx:63`
  - `submitted-sheet.tsx:56`
  - `watchlist-sheet.tsx:42`
- **Observed:** Sheets reset their form state inside `useEffect` when they become visible, which causes an extra render each time.
- **Solution:** Remount sheets with a `key` (as Grading already does for Prepare), or seed state from props. Derive the overlay's empty state instead of storing it.
- **Effort:** M

### P2-3. No CI

- **Where:** `.github/` contains only `labels.yml`.
- **Observed:** P2-1 and P2-2 reached the main branch without being caught.
- **Solution:** Add a GitHub Actions workflow that runs `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, and `pnpm --filter @cardflow/mobile lint`.
- **Effort:** S

### P2-4. Confirm and Purchased can be repeated, creating duplicates

- **Workflow:** Confirm, Purchased.
- **Where:**
  - `apps/api/src/app.ts` lines 959-1001 and 1129-1210
  - `apps/api/src/sqlite-store.ts` lines 751-825
- **Observed:** Confirming the same scan twice creates two confirmations. Saving Purchased twice from one confirmation creates two inventory copies (verified: 2 purchased rows). A retry after a network timeout duplicates inventory and PokéCollector rows.
- **Solution:**
  - Return the existing confirmation when a scan is already `identity_confirmed`.
  - Accept an `Idempotency-Key` header on Purchased and Watchlist. Alternatively, allow one inventory row per confirmation unless the user explicitly asks for another copy.
- **Effort:** M

### P2-5. Malformed JSON returns 500, and there's no global error handler or JSON body limit

- **Where:** `apps/api/src/app.ts`: every `c.req.json()` call, and no `app.onError`.
- **Observed:** A body of `{bad` returns a plain-text 500. JSON routes have no `bodyLimit`; `/v1/livestream/identify` parses up to about 8 MB of base64 per frame, four times a second.
- **Solution:** Add `app.onError` that returns `{ ok: false, error }` with 400 for `SyntaxError` and zod errors. Add `bodyLimit` to the JSON routes, about 1 MB for identify and 64 KB elsewhere.
- **Effort:** S

### P2-6. The Max Buy shown on Decide can differ from the Max Buy saved to Watchlist

- **Where:**
  - `apps/mobile/app/decide/[cardflowCardId].tsx` lines 99-107 (hardcoded `condition: "NM"`)
  - `apps/api/src/app.ts` lines 1232-1235 (Watchlist computes with no condition)
- **Observed:** If the NM factor isn't 1.0, the user sees one Max Buy on Decide and a different one is saved and shown on the tile.
- **Solution:** Send the condition with the Watchlist save and compute with it, or drop the hardcoded NM from Decide.
- **Effort:** S

### P2-7. Confirm can fall back to mock catalog fixtures

- **Where:**
  - `packages/shared/src/confirm.ts` lines 41-55
  - `apps/api/src/app.ts` lines 123, 130, and 980
- **Observed:** When the live catalog is disabled or down, `catalogCardForConfirm` returns `undefined`, and `confirmIdentity` then looks the card up in `MOCK_CARDS`. In a degraded state, a card can be confirmed from fixture data.
- **Solution:** Make the mock lookup available only through an explicit option used by tests. Otherwise return "Catalog unavailable, try again".
- **Effort:** S

### P2-8. `/health` and Settings hide when mocks are active

- **Where:**
  - `apps/api/src/app.ts` line 413
  - Settings stack rows (`SETTINGS_STACK_STATUS_ROWS`)
- **Observed:**
  - `mock` is `true` only when both the catalog and recognition are mock. The test API reported `mock: false` while recognition and grade estimate were both mock.
  - Settings has no rows for grade estimate or slab pricing.
  - Before health loads, every row reads "unavailable".
- **Solution:**
  - Report `mock: true` if any provider is mock, and add a `mockProviders: string[]` field.
  - Add Grade estimate and Slab comps rows to Settings.
  - Show "Checking…" until health loads.
- **Effort:** S

### P2-9. No error boundary and no not-found route

- **Where:** `apps/mobile/app/_layout.tsx`. There is no `ErrorBoundary` export and no `app/+not-found.tsx`.
- **Observed:** Any render error, including P0-1, crashes the screen with no way back. Bad deep links show expo-router's default "Unmatched route" page.
- **Solution:** Export an `ErrorBoundary` from the root layout with a "Try again" button and a link back to Collection. Add a `+not-found.tsx` that redirects to Collection.
- **Effort:** S

### P2-10. Not ready for a deployed beta: localhost defaults, HTTP, and dev-only build profiles

- **Where:**
  - `apps/mobile/lib/api.ts` lines 29-42
  - `apps/mobile/eas.json`
  - `apps/api/package.json` (`start: tsx src/index.ts`)
- **Observed:**
  - With no env set, the app calls `http://127.0.0.1:3001`.
  - On web and simulators it **ignores** `EXPO_PUBLIC_API_URL` completely, so a hosted web build can't reach a hosted API.
  - EAS has only a `development` profile, and the API runs through `tsx` in production.
- **Solution:**
  - Respect `EXPO_PUBLIC_API_URL` everywhere, and limit the loopback override to dev simulators.
  - Require HTTPS for non-dev builds.
  - Add `preview` and `production` EAS profiles.
  - Add a compiled API build (`tsc` or `tsup`) and run it with `node`.
- **Effort:** M

### P2-11. CORS allows any origin

- **Where:** `apps/api/src/app.ts` line 387, `cors()` with no options.
- **Solution:** Allow-list origins from `CARD_FLOW_CORS_ORIGINS`. Native apps don't need CORS.
- **Effort:** S

### P2-12. Every time Prepare opens, it runs the grade estimate again

- **Where:** `apps/mobile/components/ui/prepare-sheet.tsx` lines 121-144.
- **Observed:** Each open posts photos and runs the estimator. With the vision provider, that is a paid Anthropic call every time, even when the photos haven't changed.
- **Solution:** On the server, cache the estimate per inventory item and photo hash. Only call the provider when photos change or the user taps "Re-estimate".
- **Effort:** S

### P2-13. The live browser opens twice, and the HUD check keeps polling in the background

- **Where:**
  - `apps/mobile/components/ui/livestream-browser.tsx` lines 71-90 and 144-157
  - `apps/mobile/components/ui/screener-overlay.tsx` lines 38-59
- **Observed:** Both the effect and `onLayout` call `openLivestreamBrowser`. The HUD health check fetches every 4 seconds for as long as the tab is mounted, including when it isn't focused.
- **Solution:** Open from a single path, and run the HUD check only while the tab is focused and the scanner is on.
- **Effort:** S

---

## P3: polish and cleanup

### P3-1. Internal jargon and inaccurate copy in user-facing text

- `scan/[scanId].tsx` lines 316-323: "Reject discards this scan. No cardflow_card_id. No inventory." Nothing is actually discarded on the server.
- `scan/[scanId].tsx` line 369: "IDs stay separate."
- Settings shows raw provider IDs: `obb_phash`, `yolo_identity`, `pokecollector`.
- `export.tsx` line 79 shows the raw status (`ready_for_review`).
- Prepare subgrades read "centering 9".
- **Solution:** Add a label map for statuses and provider names, rewrite the reject copy, and make Reject actually mark the scan `identity_rejected`.
- **Effort:** S

### P3-2. Placeholder and dead UI

- The header "Notifications" bell does nothing (`app-header.tsx` lines 22-31).
- Shop has "Supplies · Later". Export has "CSV · not in private beta" and "Publish · no".
- About shows "Placeholder copy. Final wording is a founder/legal review item." (`about.tsx` line 33).
- Unused components: `components/ui/placeholder-screen.tsx` and `components/ui/tab-wireframe.tsx`.
- Expo template assets are still present: `react-logo*.png` and `partial-react-logo.png`.
- **Solution:** Hide the bell and the disabled rows, finish the legal copy, and delete the unused files.
- **Effort:** S

### P3-3. Collection and Grading show blank lists while loading

- **Observed:** On first load, the web build showed "0 purchased · 0 watching" with an empty body for several seconds, until the session was restored. Grading looked the same.
- **Solution:** Show a skeleton or spinner while `loadState === "loading"`, and hide the counts until data arrives.
- **Effort:** S

### P3-4. Web layout is not responsive

- **Observed:** On a desktop-width window, the Collection grid has two columns of oversized tiles. The Livestream region is blank on web with no explanation.
- **Solution:** Base the column count on `useWindowDimensions`. Show a "Livestream works in the iOS and Android app" message on web.
- **Effort:** S

### P3-5. Dark mode only, while iOS is set to `automatic`

- **Where:** `apps/mobile/app.json` (`"userInterfaceStyle": "automatic"`) and the fixed dark palette in `apps/mobile/lib/theme.ts`.
- **Observed:** In light mode, system Alerts and the keyboard appear light against the dark UI.
- **Solution:** Set `"userInterfaceStyle": "dark"`, or add a light palette selected with `useColorScheme`.
- **Effort:** S

### P3-6. Floating-point rounding in `dollarsToCents`

- **Where:** `packages/shared/src/money.ts` line 8.
- **Observed:** `Math.round(1.005 * 100)` returns 100, so $1.005 becomes $1.00.
- **Solution:** Parse dollars and cents from the string instead of multiplying a float. This is the same helper as P0-1.
- **Effort:** S

### P3-7. Uploaded image type is trusted from the header or file extension

- **Where:** `apps/api/src/scan-request.ts` lines 143-151, and the grade-estimate request parser.
- **Solution:** Check the file's magic bytes for JPEG, PNG, or WebP before saving it.
- **Effort:** S

### P3-8. The HUD WebView loads over HTTP with any origin allowed

- **Where:** `apps/mobile/components/ui/screener-overlay.tsx` lines 104-121.
- **Solution:** Restrict `originWhitelist` to the HUD's own origin, and use HTTPS or a bundled local HTML file.
- **Effort:** S

---

## Recommended fix order

1. **P0-1 and P3-6 together** (one safe money parser), then P0-2 and P2-5 (validation and `onError`). These remove every 500 and crash reproduced in this review.
2. **P0-3 and P0-4** (sessions and tester accounts) before anyone outside the founders gets a build.
3. **P1-1, P1-2, P1-3, and P2-7** (no mock providers outside tests), plus P2-8 so health reports any mock still active.
4. **P2-1, P2-2, and P2-3** (green typecheck and lint, plus CI) so regressions get caught.
5. **P1-4 and P1-5** (livestream rule compliance). P1-5 needs device time.
6. The remaining P1 items, then P2 and P3.

---

## Checked and found clean

- **Pricing is never copied onto drafts.** `stripCatalogPricing` runs on `catalogDisplay`, and the clipboard export leaves out private notes and the channel note.
- **Livestream identify rejects `image` and `screenshot` fields, and requires `source: "live_video"`.** The overlay guess endpoint (`GET /v1/livestream/guesses/:id`) doesn't write inventory.
- **Dev-only UI is gated behind `__DEV__`.** This covers the mock-scenario panel, the camera-off preview, the load-failure toggle, and the "Card in live video" injector.
- **Watchlist rules are enforced on the server.** Watchlist copies can't be drafted or submitted to grading.
- **Drafts never publish.** "Ready for review" requires title, condition, and asking price, and `publication.published` is always `false`.
- **Session handling is sound.** Tokens are hashed on the server with a 30-day expiry, and native clients store them in SecureStore.
- **Secrets stay off the device.** `.env`, `apps/api/data/`, and `apps/api/models/` are gitignored.
- **Migrations are consistent.** `drizzle-kit check` passes, and a fresh SQLite database migrates cleanly in tests.
- **Prepare doesn't carry photos between cards.** The sheet is keyed per item, so each card starts fresh.
- **Grading copy is correct.** It says "Photo estimate, not a cert" and never claims to be a certification.
- **Mobile `tsc --noEmit` passes when run on its own.**

## Needs device QA

- **iOS live-video frames:** whether `AVPlayer` is ever captured from Whatnot or eBay video in the Capgo browser or WKWebView (see P1-5).
- **Android live-video frames:** whether `SurfaceView` or `TextureView` `PixelCopy` sees the Chromium video surface, or only black frames.
- **In-app browser overlay:** Capgo browser position and sizing against `measureInWindow` on notched devices.
- **Capture identify:** a physical-device camera still through YOLO OBB and pHash with the real ONNX weights and index.
- **Comma-locale keypad:** typing an asking price on a device set to a comma-decimal region (expected to hit P0-1 until it's fixed).
- **SecureStore:** token persistence across app restarts, and behavior after a reinstall.
