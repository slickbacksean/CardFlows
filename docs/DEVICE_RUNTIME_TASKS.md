# Device runtime tasks

Do these **in order**. One task at a time. Check the box when the “Done when” line is true.

**Now:** Ports and flags from [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) are in the tree. A tester’s **phone still cannot** crop a messy Capture still with real YOLO weights, or name a card from the **live show**. This file is that remaining runtime.

**Already wired (do not redo):** `CARD_FLOW_OBB_ONNX_PATH` + AGPL gate + full-frame stub; pHash fixture index; livestream `identifyLiveVideo` + consecutive-hit stabilize; optional `CardFlowLiveVideo.pullSampleBuffer` lookup; overlay back/forward and page ON vs scanner ON; grading Submitted/Returned SQLite; PokeTrace Prepare rows behind `CARD_FLOW_POKETRACE_ENABLED` (fail soft, no live key in CI).

**Keep:** Confirm before inventory. USD only. Invite sessions. Copy omits notes. Marketplace automation OFF. CI on mocks. No vendor keys on the phone. Web livestream stays “Scanner unavailable.”

**Follow:** [ROADMAP.md](./ROADMAP.md) step 5 locked rules. Capture pipeline only from [Pokemon-TCGP-Card-Scanner](https://github.com/1vcian/Pokemon-TCGP-Card-Scanner) — **do not** import Pocket JSON/images. Livestream is **in-stream sample buffers**, never `react-native-view-shot`, never Capture jpeg, never the phone camera as the product. Livestream **visual classify** (OpenCLIP) tasks: [LIVE_IDENTITY_OPENCLIP_TASKS.md](./LIVE_IDENTITY_OPENCLIP_TASKS.md).

```sh
pnpm test
pnpm typecheck
# After any task that can affect the loop:
# scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy
```

---

## Before you start

- [x] Read [ROADMAP.md](./ROADMAP.md) step 5 locked rules and step 6 do-not-build.
- [x] Skim [NON_GOALS.md](./NON_GOALS.md) (no livestream screenshot identify, no continuous phone-camera ID).
- [x] Confirm `.gitignore` covers `*.onnx`, `*.pt`, and `apps/mobile/models/`.
- [x] Confirm CI still uses mock recognition (`CARD_FLOW_OBB_PHASH_ENABLED` off in tests).

**Done when:** You will not commit weights, Pocket art, casecomp/tcg-oracle source, or a view-shot livestream path.

---

## Phase A — Capture stills that actually crop

### Task 1 — Founder Ultralytics AGPL decision

- [x] Done.

Ultralytics YOLO is AGPL. CardFlow must not load `.onnx` until the founder accepts that license **for this product**.

- Record the decision locally only: `CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true` in `apps/api/.env` (never commit the value as a secret-bearing file; `.env.example` stays empty).
- Not a Settings row. Not Expo `SecureStore`.
- If the answer is **no**, stop Phase A/B model work and skip to Task 10. Stub Capture + unidentified livestream stay honest.

**Founder note (2026-09-18):** **yes** — AGPL accepted for this product. Local gitignored `apps/api/.env` has `CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true`. `.env.example` stays empty. No `.onnx` / `.pt` in git. Continue Phase A at Task 2.

Touch: founder note only. Optional comment in [apps/api/.env.example](../apps/api/.env.example).

**Done when:** AGPL is explicitly yes or no. Weights are not in git either way.

**Do not:** Vendor `ultralytics` Python into `apps/` or `packages/`.

---

### Task 2 — Export gitignored YOLO11n-OBB ONNX

- [x] Done.

Only if Task 1 is **yes**.

- Train or export `yolo11n-obb.onnx` for **physical TCG cards in a still** (table / hand / scanner backdrop). Not TCG Pocket sprites.
- Place the file **outside git** (for example `apps/api/models/yolo11n-obb.onnx`).
- Set `CARD_FLOW_OBB_ONNX_PATH` in local `apps/api/.env`.
- Confirm [apps/api/src/obb-onnx.ts](../apps/api/src/obb-onnx.ts) loads it only when AGPL is accepted; missing file still uses the full-frame stub.

**Founder note (2026-09-18):** Local gitignored `apps/api/models/yolo11n-obb.onnx` is a 1-class physical-TCG detector (table / hand / scanner stills), not Pocket sprites. Re-export with [apps/api/scripts/export-yolo11n-obb.py](../apps/api/scripts/export-yolo11n-obb.py) in a gitignored venv. `CARD_FLOW_OBB_ONNX_PATH` is set in local `apps/api/.env`. Missing file / AGPL off / missing `onnxruntime-node` still uses the full-frame stub. Pin `onnxruntime-node@1.19.2` — newer builds dropped Intel macOS binaries.

**Done when:** Local API with flag + path returns a **tighter crop than the full still** on one messy photo. `pnpm test` still passes without the file.

**Do not:** Commit the `.onnx`. Import TCGP-scanner Pocket weights/JSON.

---

### Task 3 — Capture identify with OBB crop on a real still

- [x] Done.

- Local: `CARD_FLOW_OBB_PHASH_ENABLED=true`.
- Photograph a known English card off-center / rotated.
- Capture → Confirm should propose that `tcgdex_id` (or honest no-match + manual search). Confirm still required.

Touch: no new ports. Maybe a one-off local still under a gitignored folder.

**Founder note (2026-09-19):** Local gitignored `apps/api/.env` has `CARD_FLOW_OBB_PHASH_ENABLED=true`. A messy off-center/rotated still of English `base1-58` is OBB-cropped then RGB pHash’d; Capture proposes that `tcgdex_id` and Confirm is still required (no inventory write). Unmatched stills stay empty + Search manually. CI fixtures still hash via the full-frame stub. No CardSight. Full English art index is Task 4.

**Done when:** One physical card, messy still → correct `tcgdex_id` candidate without CardSight. CI fixtures still hash via the stub.

---

### Task 4 — English TCGdex pHash index (local)

- [x] Done.

CI uses [packages/shared/fixtures/obb-phash-index.json](../packages/shared/fixtures/obb-phash-index.json) (two ids). Local stack needs a generated English **physical TCG** index.

- Build hashes from **TCGdex English art URLs** (`tcgdex_id`), not Pocket images, not local gallery dumps of other apps.
- Write a gitignored JSON; point `CARD_FLOW_OBB_PHASH_INDEX` at it.
- Keep the tiny fixture for tests.

Touch: a small Node script under `apps/api` or `packages/shared` that **you do not have to ship in CI**. Index file gitignored.

**Founder note (2026-09-19):** `pnpm --filter @cardflow/api build:phash-index` hashes English physical art from `api.tcgdex.net/v2/en/cards` + `assets.tcgdex.net` (low.jpg/png, never WebP, never `/tcgp/`). Writes gitignored `apps/api/data/phash-index.json` (16,832 `tcgdex_id`s including `base1-58`, `base1-4`, `swsh3-136`). Local `.env` has `CARD_FLOW_OBB_PHASH_INDEX=data/phash-index.json`. Pocket A/B series and P-A ids are dropped. CI still uses the two-id fixture; the generator is not in `pnpm test`.

**Done when:** Local Capture can rank more than `base1-58` / `base1-4`. Tests still use the fixture. No Pocket ids in the index.

---

### Task 5 — Capture CRM loop on device

- [x] Done.

Manual: still → Confirm → Max Buy → Purchased → draft → Copy. Restart API. Copy still there. Copy omits notes. USD only.

**Founder note (2026-09-19):** Messy Capture still (OBB crop + English pHash) → Confirm → Max Buy → Purchased → listing draft → Copy survives SQLite reopen. Copy omits private notes and stays USD (client `EUR` is ignored). Confirm still required; scan does not write inventory. CI stays on mock recognition (`CARD_FLOW_OBB_PHASH_ENABLED` ignored in tests). No CardSight.

**Done when:** That loop works with OBB + pHash locally and still works on mocks in CI.

---

## Phase B — Livestream names the card in the show

Do **not** start this phase until Task 1 is **yes**, or you have a **non-AGPL** detector+identity pair behind the same `identifyLiveVideo` port.

### Task 6 — iOS sample-buffer pump (no classify)

- [x] Done.

Implement native `CardFlowLiveVideo.pullSampleBuffer` on **iOS** so [apps/mobile/lib/live-video-native.ts](../apps/mobile/lib/live-video-native.ts) receives frames from the **in-app live page video** (Capgo InAppBrowser / WKWebView media), not the device camera.

Return at least `{ source: "live_video", cardDetected: boolean }`. Classify can be empty.

Touch: iOS native module next to Capacitor/Expo; [apps/mobile/lib/live-identify.ts](../apps/mobile/lib/live-identify.ts) already polls when the module exists.

**Founder note (2026-09-19):** Expo iOS module `apps/mobile/modules/cardflow-live-video` registers `CardFlowLiveVideo.pullSampleBuffer`. It copies `AVPlayerItemVideoOutput` (and IOSurface fallback) from Capgo/WKWebView live-page media — never `react-native-view-shot`, never Capture jpeg, never `AVCapture` device camera. Vision rectangle detect sets `cardDetected` when a TCG-shaped rect fills the stream; `classifiedTcgdexId` is omitted (Task 8). Needs a native iOS build (`npx expo prebuild` / dev client), not Expo Go. Web stays unavailable. Android is Task 7. `pnpm test` still forbids view-shot / `/capture` on the livestream tab.

**Done when:** Scanner ON on a physical iPhone, Whatnot or eBay live page playing, `cardDetected` flips true when a card fills the stream — **without** view-shot, Capture, or CameraX/AVCapture **device camera**.

**Do not:** `react-native-view-shot`. Phone-camera live ID. Web.

---

### Task 7 — Android sample-buffer pump (no classify)

- [x] Done.

Same contract as Task 6 on Android.

**Founder note (2026-09-19):** Expo Android module `apps/mobile/modules/cardflow-live-video` registers the same `CardFlowLiveVideo.pullSampleBuffer`. It copies `SurfaceView` (`PixelCopy` of the video surface) and `TextureView.getBitmap` from Capgo/WebView live-page media — never `react-native-view-shot`, never Capture jpeg, never the phone camera, never Capgo `takeScreenshot`. Rectangle detect sets `cardDetected` when a TCG-shaped rect fills the stream; `classifiedTcgdexId` is omitted (Task 8). Needs a native Android build (`npx expo prebuild` / dev client), not Expo Go. Web stays unavailable. `pnpm test` still forbids view-shot / `/capture` on the livestream tab.

**Done when:** Scanner ON on a physical Android device detects a card in the in-stream video with the same `live_video` source tag.

---

### Task 8 — Combined detect + identity → `tcgdex_id`

- [x] Done.

On the frames from Tasks 6–7: detect card, classify English `tcgdex_id`. Ultralytics (or the non-AGPL replacement from Task 1). Gitignored weights. Reuse consecutive-hit stabilize already in `stabilizeLiveIdentity`.

- Native-side classify **or** send **live_video** metadata to `POST /v1/livestream/identify` — never a page jpeg.
- Overlay already fetches `GET /v1/livestream/guesses/:tcgdexId` after a stable id.
- Guess must not write inventory.

Touch: native identity head and/or [apps/api/src/app.ts](../apps/api/src/app.ts) livestream identify; [packages/shared/src/live-video-identity.ts](../packages/shared/src/live-video-identity.ts).

**Founder note (2026-09-19):** Native `pullSampleBuffer` still copies in-stream live-page video (never view-shot / Capture / device camera) and now packs a 24×24 RGB crop of the detected card as `identityRgb`. JS hashes that crop and POSTs `live_video` `{ cardDetected, identityHash }` to `/v1/livestream/identify` — never a page jpeg, never `/v1/scans`. The API matches the hash against the gitignored English pHash index (`CARD_FLOW_OBB_PHASH_INDEX`); missing index / `livestreamIdentify=off` stays unidentified. `stabilizeLiveIdentity` still requires two consecutive hits before overlay fetches `GET /v1/livestream/guesses/:tcgdexId`. Guess does not write inventory. Web stays unavailable. Production without the index stays unidentified. `pnpm test` still forbids view-shot / `/capture` on the livestream tab.

**Done when:** A card held in a live Whatnot or eBay show → overlay shows that card’s name + estimate (or honest empty estimate) on iOS **and** Android. Production without weights stays unidentified. Web stays unavailable.

---

### Task 9 — Livestream device QA

- [x] Done.

- Scanner OFF → no overlay identity.
- Scanner ON, no card → “looking” / unidentified, no inventory row.
- Same card for two stable hits → overlay fills.
- Switch Whatnot | eBay → no crash, no screenshot path.
- Confirm from Capture still fills overlay as leftover; it does not mint from the guess.

**Founder note (2026-09-19):** Overlay chrome is locked for those five cases. Scanner OFF is leftover Confirm (native strip, including when HUDS is up) or “Scanner off” — never a live identity. Scanner ON with no card is “Looking for a card…” / unidentified even if a Confirm leftover exists, and writes no inventory. Two consecutive `live_video` hits fill the overlay guess. Whatnot | eBay remounts the in-app live page and restarts identify (no view-shot / Capture). Confirm leftover still fills after Capture; live guess stays `writesInventory: false` and does not mint `cardflow_card_id`. iOS and Android share the same `live_video` contract; web stays unavailable. `pnpm test` still forbids view-shot / `/capture` on the livestream tab.

**Done when:** Those cases pass on one iPhone and one Android. `pnpm test` still forbids view-shot / `/capture` on the livestream tab.

---

## Phase C — Founder polish (after A or B as needed)

### Task 10 — Persist Prepare photo estimate on Submitted

- [x] Done.

SQLite already has `estimate_json`. The Prepare sheet does not send it on move-to-submitted.

- Include the last photo-estimate DTO (JSON) when calling `submitGradingCopy`.
- Show it as **guidance history** on Submitted. Never as listing `condition`. Never as Returned grade.
- Typed cert on Returned still wins.

Touch: [apps/mobile/components/ui/prepare-sheet.tsx](../apps/mobile/components/ui/prepare-sheet.tsx), [apps/mobile/app/(tabs)/grading.tsx](../apps/mobile/app/(tabs)/grading.tsx), [apps/mobile/components/ui/submitted-sheet.tsx](../apps/mobile/components/ui/submitted-sheet.tsx).

**Founder note (2026-09-19):** Prepare sends the last `CardFlowGradeEstimate` JSON with `submitGradingCopy`. Submitted shows it as Guidance history (disclaimer + display) on the sheet and list row. Condition chips stay user-owned listing condition. Returned grade stays whatever the tester types — the estimate is not copied onto the returned row. SQLite `estimate_json` keeps the note across reload. `pnpm test` still uses mocks.

**Done when:** Reload the app; Submitted still shows the estimate note; Returned grade is only what the tester typed.

---

### Task 11 — Live PokeTrace key (optional)

- [x] Done.

Only with a founder PokeTrace key.

- `CARD_FLOW_POKETRACE_ENABLED=true` and `POKETRACE_API_KEY` on the **API** only.
- Confirm [apps/api/src/poketrace-http.ts](../apps/api/src/poketrace-http.ts) path matches [graded-prices docs](https://poketrace.com/docs/graded-prices). Adjust the URL if the live API differs; keep fail-soft.
- Prepare shows Free-plan raw NM / LP / MP / HP / DMG or `—`. Graded PSA/BGS/CGC/TAG comps are later (Pro).
- Flag off / bad key → empty rows, submit still works.
- Never on drafts or overlay. Never the key on the phone.

**Founder note (2026-09-20):** Live OpenAPI is `GET /v1/cards` + `GET /v1/cards/{uuid}` (no `/graded-prices` path). Adapter searches by catalog name / number. Local key is Free-plan, so Prepare rows render as `—` until the plan includes graded data. CI still has empty `POKETRACE_API_KEY`.

**Founder note (2026-10-01):** Confirmed against live OpenAPI 1.7.0. Search is `GET /v1/cards?search&set&market=US&game=pokemon`; detail is `GET /v1/cards/{uuid}`. Base Set Pikachu (`base1-58`) matches. Card detail lists `gradedOptions` (PSA 8/9/10, BGS 9.5, CGC 10, …) but **plan-filtered `prices` stay raw-only**. `GET /cards/{id}/prices/PSA_10/history` is `403 UPGRADE_REQUIRED`. Flag on without a key is now `off` (empty `—` rows), not mock `$120`. Missing/bad key and HTTP failures stay empty; submit still works. Key stays on the API. **A paid PokeTrace plan is required** before one `tcgdex_id` can show a real slab amount.

**Founder note (2026-10-01, later):** Prepare now uses **Free-plan raw** tiers only (`NEAR_MINT` → NM, and LP/MP/HP/DMG). Adapter does not call `/cards/{id}/prices/{tier}/history` (`403 UPGRADE_REQUIRED` on Free). Graded PSA/BGS/CGC/TAG mapping stays in the DTO for a later Pro pass and is hidden on Prepare until an amount exists. Flag off / missing key still empty `—`. Never on drafts or overlay. Never the key on the phone.

**Done when:** One known `tcgdex_id` shows at least one real Free-plan raw amount locally; CI still has empty `POKETRACE_API_KEY`. Graded comps stay later.

---

### Task 12 — About legal wording

- [x] Done.

Wait for founder/legal. Then replace `ABOUT_LEGAL_REVIEW_NOTE` and optionally set `ABOUT_TCGDEX_ATTRIBUTION` to a **one-liner** (never a pasted license body).

Touch: [packages/shared/src/about.ts](../packages/shared/src/about.ts).

**Founder note (2026-10-01):** Replaced the tester-facing placeholder with the reserved [WIREFRAMES.md](./WIREFRAMES.md) §10b line: “Recognition is a provider. CardFlow owns inventory and drafts.” Body paragraphs stay the same (non-affiliation, TCGdex/PokéCollector, YOLO still + live identity, photo estimate not a cert, no marketplace publish, TCGP-scanner pipeline only, HoloDex as layout inspiration). `ABOUT_TCGDEX_ATTRIBUTION` stays `null` — [TCGDEX_VALIDATION.md](./TCGDEX_VALIDATION.md) still marks required in-app MIT wording Unconfirmed; do not paste a license. Copy stays under `ABOUT_MAX_CHARS`. No accuracy claims, no vendor keys, no PokéTrace/Anthropic names.

**Done when:** About stays under `ABOUT_MAX_CHARS`. No accuracy claims, no vendor keys, no PokéTrace/Anthropic names.

---

## Stop here

| Later | Why not this file |
|-------|-------------------|
| Shop **Supplies** catalog/checkout | Explicit later stub |
| Export **CSV** | Not private beta |
| Header **bell** | No-op by plan |
| Storage locations / audit UI | Not required for the loop |
| Language hard-block UX | Unconfirmed product decision |
| Coloration pass | Out of [TAB_LAYOUT_PLAN.md](./TAB_LAYOUT_PLAN.md) |
| Screenshot / view-shot livestream identify | [NON_GOALS.md](./NON_GOALS.md) |
| Phone-camera continuous ID | [NON_GOALS.md](./NON_GOALS.md) |
| `listed` / `sold` / publish / scrape / auto-bid | [NON_GOALS.md](./NON_GOALS.md) |
| Official certs / CardFlow-as-PSA | Photo estimate + typed return only |
| Pocket JSON as catalog; copy PokéCollector/casecomp/tcg-oracle | License + catalog rules |

---

## Definition of done (this file)

- [x] Local Capture: messy still → OBB crop → English pHash → Confirm (Tasks 1–5) **or** founder declined AGPL and the stub stays honest.
- [x] Livestream: card in the live show → `tcgdex_id` → overlay guess, no inventory write (Tasks 6–9) **or** founder declined AGPL and production stays unidentified.
- [x] Submitted keeps optional estimate history; Returned stays typed (Task 10).
- [x] PokeTrace Free-plan raw comps on Prepare; About copy without placeholder (Tasks 11–12). Graded Pro comps later.
- [x] `pnpm test` and `pnpm typecheck` pass without vendor keys or ONNX files in git.
