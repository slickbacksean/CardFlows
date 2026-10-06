# Livestream OpenCLIP identity tasks

Do these **in order**. One task at a time. Check the box when the “Done when” line is true.

**Source decision:** [LIVE_VISUAL_MODEL.md](./LIVE_VISUAL_MODEL.md)  
**Pipeline inspiration (MIT, do not vendor):** [t-sinclair2500/pokemon-scanner](https://github.com/t-sinclair2500/pokemon-scanner) — OpenCLIP ViT-B/32 + HNSW (+ optional ORB re-rank, OCR fallback).  
**Product rules:** [ROADMAP.md](./ROADMAP.md) step 5 livestream identify; [DEVICE_RUNTIME_TASKS.md](./DEVICE_RUNTIME_TASKS.md) Frames 6–9.  
**Last reviewed:** 2026-09-24

**Job:** On Scanner ON, name the English card in the **in-stream** Whatnot / eBay video (`tcgdex_id`) so the HUD shows Estimate + Max Buy. Overlay guesses do **not** write inventory.

**Already scaffolded (do not redo from scratch):**

| Piece | Location |
|-------|----------|
| Decision + non-goals | [LIVE_VISUAL_MODEL.md](./LIVE_VISUAL_MODEL.md) |
| OpenCLIP sidecar | `services/live-identity-openclip/` (`serve.py`, smoke + TCGdex index builders) |
| API client + prefer-crop path | `apps/api/src/live-identity-openclip.ts`, `/v1/livestream/identify` |
| Native JPEG crop + 24×24 pHash | `CardFlowLiveVideo` iOS/Android; mobile `live-identify.ts` |
| pHash fallback | existing `CARD_FLOW_OBB_PHASH_INDEX` |

**Keep:** No page screenshots. No phone-camera product path. No PokéCollector Gemini. No pokemon-scanner CLI/CSV UI in the app. No vendor keys on the phone. CI on mocks. Web stays “Scanner unavailable.”

```sh
pnpm test
pnpm typecheck
# After device tasks:
# Scanner ON → card in show → overlay live guess (not confirmed) → no inventory row
```

---

## Overall architecture

```text
Whatnot / eBay WebView (in-app)
        │
        ▼
CardFlowLiveVideo.pullSampleBuffer   ← native build only (not Expo Go)
   • detect card rect in stream
   • identityRgb (24×24) → JS pHash
   • identityCropJpeg (≤448px) → API
        │
        ▼
POST /v1/livestream/identify  { source: "live_video", … }
        │
        ├─ if OpenCLIP URL + crop  → sidecar /v1/match  → tcgdex_id
        └─ else / fail-soft        → English pHash index → tcgdex_id
        │
        ▼
stabilizeLiveIdentity (2 hits) → GET /v1/livestream/guesses/:id → HUD
```

**PokéCollector** stays HTTP catalog + USD estimates only. **pokemon-scanner** contributes the *visual match idea* only — CardFlow owns the sidecar and TCGdex-keyed index.

---

## Phase 0 — Premises (read before coding)

### Task 0.1 — Confirm constraints

- [x] Done.

- Livestream frames come from Capgo / WKWebView / Android WebView **media**, never `react-native-view-shot`, never Capture `/v1/scans`, never device camera as the product.
- Index keys are English **`tcgdex_id`**, not pokemontcg.io ids.
- Expo Go cannot load `CardFlowLiveVideo` — a **dev client / native binary** is required for real shows.

**Done when:** You will not add Gemini, view-shot, or a phone-camera live ID product.

---

## Phase A — Sidecar ready for local API

Goal: Mac can classify a crop JPEG without the phone.

### Task A1 — Python venv + deps

- [x] Done.

```bash
cd services/live-identity-openclip
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Touch: local only (`.venv/` gitignored).

**Done when:** `python -c "import open_clip, hnswlib, fastapi"` succeeds.

**Do not:** Commit the venv or torch wheels.

---

### Task A2 — Smoke index + health

- [x] Done.

```bash
python scripts/build_smoke_index.py
pnpm live-identity:up
pnpm live-identity:health
curl -s http://127.0.0.1:8092/health
```

**Done when:** `/health` → `ok: true`, `indexed` ≥ 3, `pipeline: "openclip_hnsw"`.

---

### Task A3 — Wire API env

- [x] Done.

In gitignored `apps/api/.env`:

```bash
CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL=http://127.0.0.1:8092
# optional shared secret matching LIVE_IDENTITY_TOKEN
# CARD_FLOW_LIVE_IDENTITY_OPENCLIP_TOKEN=
```

Restart `pnpm dev:api`. Log line should show `Live identity OpenCLIP: on`.

**Done when:** API boot log shows OpenCLIP on; with URL unset, boot still works and identify falls back to pHash.

**Do not:** Put the token in Expo / Settings / SecureStore.

---

### Task A4 — API crop round-trip (no phone)

- [x] Done.

POST a tiny JPEG as `identityCropJpeg` to `/v1/livestream/identify` with `cardDetected: true` (session as usual). With smoke index colors, expect fail-soft or a smoke id; with a mocked sidecar client, tests already cover preference over pHash.

Manual: after A2–A3, `POST /v1/match` multipart `crop` with a saved card photo crop → ranked candidates.

**Done when:** Sidecar returns candidates; API prefer-OpenCLIP path covered by `app.livestream-guess.test.ts`.

---

## Phase B — Full English visual index

Goal: Real cards (not smoke solids) match to `tcgdex_id`.

### Task B1 — Build TCGdex OpenCLIP index

- [x] Done. *(Full English index built 2026-09-30: 19,665 of 19,666 planned cards across 11 groups; only `dc1-1` Team Magma's Numel is missing — TCGdex has no art for it.)*

```bash
# Slow; downloads low.jpg from assets.tcgdex.net. Output gitignored.
# Full index in set-grouped batches (~2000 cards; 11 groups as of 2026-09-28):
python scripts/build_tcgdex_batches.py plan
python scripts/build_tcgdex_batches.py build --next   # one group per run; repeat (retries skipped art up to 3 slower passes)
python scripts/build_tcgdex_batches.py status
python scripts/build_tcgdex_batches.py merge --partial   # serve what is built so far
# Small single-shot pass (sets are taken in the order given, then truncated):
#   python scripts/build_tcgdex_index.py --out data/index --limit 300 --sets base1,base2,base3,base4
export LIVE_IDENTITY_INDEX="$(pwd)/data/index"
pnpm live-identity:up   # or restart serve.py
```

**Founder note (2026-09-28):** First pass indexed 300 cards (base1 ×102, base2 ×64, base3 ×62, base4 ×72) in ~7 min on MPS. Builder fixed: asset URL now uses the listing `image` field (the old `/en/{set}/{local}` path 404'd), TCG Pocket (`/tcgp/` art, 2,321 cards) is excluded, and `--limit` counts embedded cards. `base1-58` high.jpg accepts at 0.98 clean and 0.90 on a rotated/blurred/q35 "live" crop. **Open for B2/C1:** wrong candidates sit at 0.86–0.88 (margin to top-1 only ~0.025 on degraded crops), and 2 of 3 not-indexed cards falsely accepted above 0.82 (`base5-1` Dark Alakazam → `base1-1` Alakazam at 0.89; `sv03.5-025` → `base2-21` at 0.87). Needs a higher threshold and/or a top-1 vs top-2 margin gate, and ORB re-rank for same-Pokémon near-ties.

**Founder note (2026-09-30):** Each group takes ~30–35 min, mostly embedding (a fully cached rebuild still takes ~20 min). assets.tcgdex.net drops long runs of downloads under load (up to 1,542 of 1,991 in one pass), so `build` retries skipped cards in up to 3 slower passes and falls back to `low.png` when `low.jpg` 404s (e.g. `sv01-021`). Run builds under `caffeinate -i` and detached from the terminal (`perl -MPOSIX=setsid -e 'setsid; exec @ARGV' …`); a sleeping Mac or closed terminal session killed two runs and the sidecar.

Touch: `services/live-identity-openclip/scripts/build_tcgdex_index.py`, `build_tcgdex_batches.py`. Never commit `data/` (index, batches, cached art).

**Done when:** `/health` `indexed` is thousands (or your `--limit`); one known crop of `base1-58` accepts that id above threshold.

**Do not:** Import TCG Pocket art. Use WebP as the index source (prefer `low.jpg` / png as the builder does).

---

### Task B2 — Accept threshold + LAN URL for device

- [x] Done.

- Tune `LIVE_IDENTITY_ACCEPT` (default `0.86`) and `LIVE_IDENTITY_MARGIN` (default `0.02`) with `python scripts/eval_accept.py` if false accepts / rejects on messy live crops.
- For phone → Mac: bind sidecar host if needed (`LIVE_IDENTITY_HOST=0.0.0.0`) and set API + (if phone ever called sidecar directly — it must **not**) only API LAN URL. Phone talks to CardFlow API only; API talks to sidecar on loopback or LAN.

**Done when:** Phone’s `EXPO_PUBLIC_API_URL` hits API; API hits OpenCLIP; no OpenCLIP URL on the device.

**Founder note (2026-09-30):** `scripts/eval_accept.py` samples 800 indexed cards, degrades their `high.jpg` into "mild" and "live" crops, and scores each crop twice: with the card indexed, and with its whole set hidden (a not-yet-indexed set). On the full 19,665-card index the old gate (0.82, no margin) wrong-accepted 3.4% of mild / 35% of live crops and false-accepted 91% / 50% with the set hidden. New gate **0.86 + top-1−top-2 margin 0.02**: mild 90.9% correct, 0.2% wrong, 13% false with set hidden; live 5.9% correct, 0.1% wrong, 0.6% false. Hidden-set false accepts are ~80–97% the same Pokémon (same-art reprints, e.g. `base1-36` ↔ `base4-51`); near-ties now return `reason: "ambiguous"`. Live recall is the open problem: each degradation alone keeps top-1 at 90–98%, but low res + JPEG together drop it to 81% and loose framing (background around the card) to 90%; all combined 25%. Tight native crops matter more than the threshold — revisit with real frames after Phase D. LAN: API `.env` → `CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL=http://127.0.0.1:8092` (sidecar stays on loopback); mobile `.env` → `EXPO_PUBLIC_API_URL=http://172.20.10.2:3001`; no sidecar URL in `apps/mobile`. `POST http://172.20.10.2:3001/v1/livestream/identify` with a `base1-58` crop → `identified` / High; phone itself not re-tapped this session.

---

## Phase C — Close the pokemon-scanner parity gaps (sidecar)

Scaffold has embed + HNSW. Upstream also uses ORB re-rank and OCR fallback. Add only what helps **livestream** crops.

### Task C1 — ORB re-rank top-K (optional but recommended)

- [x] Done.

After HNSW top-K, re-rank with ORB inliers (same idea as pokemon-scanner `match/rerank.py`). Recompute confidence from distance + inliers. Keep fail-soft.

Touch: `services/live-identity-openclip/serve.py` (+ small opencv helper). Prefer OpenCV contrib-free ORB.

**Founder note (2026-10-03):** See [REMAINING_TASKS.md](./REMAINING_TASKS.md) P1-4. Fixture and `base1-36` / `base4-51` both re-rank to the true print. No reference image → cosine-only.

**Done when:** Ambiguous near-ties (same Pokémon, different set) improve on a fixed fixture set; smoke path still works without images on disk for ORB (skip re-rank if ref image missing).

**Do not:** Block identify on ORB failure — fall back to cosine-only accept.

---

### Task C2 — OCR fallback (defer if livestream blur ruins it)

- [ ] Done. *(May stay deferred.)*

Bottom-band collector number OCR is weak on compressed live video. Only add if ORB+OpenCLIP still miss clear upright cards. Map OCR number + fuzzy name → TCGdex search via existing CardFlow catalog HTTP — **not** pokemontcg.io resolver.

**Done when:** Either deferred with a founder note, or OCR only runs when OpenCLIP similarity is in a “review” band and never invents an id on low OCR confidence.

**Do not:** Make OCR the primary livestream path.

---

## Phase D — Native build (unblock real frames)

Without this phase, Expo Go never posts real `identityCropJpeg` from Whatnot.

### Task D1 — Tooling gate

- [ ] Done.

Pick one:

| Path | Requirement |
|------|-------------|
| Local `npx expo run:ios --device` | **Xcode ≥ 16.1** (RN 0.86 / Expo 57) |
| EAS development build | EAS project + device register; no local Xcode 16 |

Record which path in a founder note here.

**Done when:** You can install a binary that includes `cardflow-live-video` + Capgo InAppBrowser.

**Founder note (2026-09-30):** Path = **EAS development build**. Local is blocked: Xcode 15.2 on macOS 13.7.8, and Xcode 16.1+ needs macOS 14.5+. EAS project [@slickbacksean/cardflow](https://expo.dev/accounts/slickbacksean/projects/cardflow) is linked (`app.json` `extra.eas.projectId`); `apps/mobile/eas.json` has a `development` profile (dev client, internal distribution, Node 22.22.0). Needs an Apple Developer Program membership for ad hoc install. **Capgo does not belong in this binary:** `@capgo/capacitor-inappbrowser` is a Capacitor plugin and needs a Capacitor app shell, which this React Native app does not have. `apps/mobile/react-native.config.js` skips its native linking, `isCapgoLivestreamBrowserAvailable()` already returns false outside Capacitor, and the livestream tab uses `react-native-webview`. `cardflow-live-video` scans every `WKWebView`, so it still sees that page. Local CLI note: this Mac's default `node` is 18; use Node 22 (`nvm use 22`) for Expo 57 commands.

---

### Task D2 — Dev client config

- [ ] Done.

- Add `expo-dev-client` if missing. *(Added `~57.0.19`, 2026-09-30.)*
- Ensure config plugins / autolinking pick up `apps/mobile/modules/cardflow-live-video`. *(Verified: Expo autolinking lists `cardflow-live-video` + dev client; `@capgo/capacitor-inappbrowser` is excluded from native linking — see D1 note.)*
- `npx expo prebuild` (or EAS prebuild) → install on **Sean’s iPhone** (and later one Android).

**Done when:** In the installed app, `isLiveVideoNativeAvailable()` is true (Scanner is not permanently “unavailable” / mock-only).

**Do not:** Rely on Expo Go for this phase.

---

### Task D3 — Frame smoke on device

- [ ] Done.

Scanner ON on a live Whatnot/eBay show with a card filling the frame:

- Native logs / temporary DEV HUD: `cardDetected: true`
- API receives `identityCropJpeg` (non-null) and/or `identityHash`
- Still **no** view-shot / `/capture` on this tab

**Done when:** At least one identify request from the phone includes a crop or hash while a card is on screen.

---

## Phase E — End-to-end livestream QA

### Task E1 — Stable guess → HUD

- [ ] Done.

Two consecutive OpenCLIP (or pHash) hits → overlay shows name + Estimate + Max Buy + Grade `—`. Guess `writesInventory: false`.

**Done when:** Matches [DEVICE_RUNTIME_TASKS.md](./DEVICE_RUNTIME_TASKS.md) Task 9 cases for live guess, with OpenCLIP preferred when sidecar is up.

---

### Task E2 — Fail-soft matrix

- [ ] Done.

| Condition | Expected |
|-----------|----------|
| Scanner OFF | Never live identity |
| Scanner ON, no card | Looking / unidentified |
| Sidecar down | pHash or unidentified; no crash |
| Index missing | Unidentified; no crash |
| Whatnot ↔ eBay switch | Remount live page; no screenshot path |
| Confirm leftover | Native leftover strip when scanner off |

**Done when:** Matrix verified on one iPhone (Android follow-up OK).

---

### Task E3 — Latency budget

- [x] Done.

Target: identify poll ~250 ms; OpenCLIP match p95 **&lt; 400 ms** on Mac CPU/MPS for 448px crop (or document honest slower number and lower poll rate). Drop frames rather than queue backlog (`pollInFlight` already gates).

**Founder note (2026-10-03):** Warm MPS match is about 630 ms cosine-only and 720 ms with ORB. Cold start is about 2 s. Poll is 800 ms. `pollInFlight` drops frames. See P1-4 in [REMAINING_TASKS.md](./REMAINING_TASKS.md).

**Done when:** Founder note records measured p50/p95; HUD does not stutter the WebView.

---

## Phase F — Docs / health polish

### Task F1 — `/health` visibility

- [x] Done.

Optional: expose `liveIdentityVisual: "openclip" | "phash" | "off"` (or log-only is enough if you refuse schema churn). Never leak tokens.

**Done when:** Operator can tell whether OpenCLIP is wired without reading boot logs only — or boot log is documented as the source of truth.

---

### Task F2 — Priority docs

- [x] Done.

Update [RUNTIME_CONFIG_PRIORITY.md](./RUNTIME_CONFIG_PRIORITY.md) livestream row to: OpenCLIP sidecar + pHash fallback; native build required.

**Done when:** Priority table matches this file.

---

## Suggested order (summary)

| Phase | Focus | Blocks |
|-------|--------|--------|
| **A** | Sidecar + API env on Mac | Everything cloud-visual |
| **B** | Full TCGdex index | Real card names |
| **C** | ORB (then maybe OCR) | Accuracy on near-ties |
| **D** | Native / EAS build | Real Whatnot frames |
| **E** | Device QA + latency | Ship confidence |
| **F** | Health / priority docs | Operator clarity |

Do **not** start Phase C before A–B. Do **not** treat simulator Expo Go as Phase E success.

---

## Out of scope

- Vendoring pokemon-scanner or PokéCollector source into `apps/` / `packages/`
- PokéCollector Gemini / any cloud vision LLM on this tab
- Replacing Capture OBB+pHash with OpenCLIP (Capture stays TCGP-scanner pipeline)
- PokeTrace / PSA comps on the livestream HUD
- Auto-bid, scrape, account automation
