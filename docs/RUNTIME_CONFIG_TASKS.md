# Runtime config tasks

Do these **in order**. One task at a time. Check the box when the “Done when” line is true.

**Source:** [RUNTIME_CONFIG_PRIORITY.md](./RUNTIME_CONFIG_PRIORITY.md)  
**Last reviewed:** 2026-09-20

**Already operational (do not redo):** Capture OBB + pHash, TCGdex catalog, SQLite + local session, livestream identity via crop → identityHash → pHash. CNN sidecar smoke path is wired (upstream clone, venv, untrained `phase2_best.pth`, API env) — verify Prepare next; do not trust smoke grades.

**Keep:** Secrets only in gitignored `apps/api/.env`. Expo may hold public LAN URLs only (`EXPO_PUBLIC_*`). Never commit `.pth` / `.onnx` / keys. CI stays on mocks. No vendor keys on the phone.

**Suggested order:** P0 (phone) → P2 PokeTrace → P1 CNN smoke verify → P1 alt Claude (usable interim) → PokéCollector (if needed) → HUDS → P3 noop → trained CNN later.

```sh
# After config changes that affect the API:
curl -s http://127.0.0.1:3001/health
# CRM loop smoke when touching device reachability:
# scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy
```

---

## Before you start

- [x] Skim [RUNTIME_CONFIG_PRIORITY.md](./RUNTIME_CONFIG_PRIORITY.md) priority list and verification cheat sheet.
- [x] Confirm [apps/api/.env.example](../apps/api/.env.example) stays empty placeholders (no secrets).
- [x] Confirm secrets stay in gitignored `apps/api/.env` only; mobile `.env` is public URLs only.
- [x] Confirm API default port is `3001` when `PORT` is unset.

**Done when:** You will not paste keys into docs or commit weights.

---

## Phase A — P0 Device ↔ API reachability

**Why first:** Blocks all CRM on a real phone. Simulator defaults to `http://127.0.0.1:3001`; Android emulator to `http://10.0.2.2:3001` ([apps/mobile/lib/api.ts](../apps/mobile/lib/api.ts)).

### Task A1 — LAN API URL on physical device

- Find Mac LAN IP (`ipconfig getifaddr en0` or equivalent).
- Create/update gitignored `apps/mobile/.env`:
  ```bash
  EXPO_PUBLIC_API_URL=http://<lan-ip>:3001
  ```
- Ensure phone and Mac share Wi‑Fi; no VPN blocking LAN.
- Restart Expo (`pnpm dev:mobile`).

**Founder note (2026-09-20):** LAN IP for this machine was `10.0.0.43`. Gitignored `apps/mobile/.env` sets `EXPO_PUBLIC_API_URL=http://10.0.0.43:3001`. Skip A1–A2 if you only use simulator (defaults already work).

Touch: `apps/mobile/.env` only (gitignored).

**Done when:** App on phone can hit `GET /health` via that URL (no “Cannot reach the mock API…”).

**Do not:** Put server secrets in Expo env.

- [x] Mobile `.env` created with LAN API URL (device testers must restart Expo and confirm from phone).

### Task A2 — Smoke one CRM round-trip from device

- On the physical device: scan → confirm → Max Buy once against the LAN API.

**Founder note (2026-09-20):** LAN CRM write succeeded against `http://10.0.0.43:3001` after the PokéCollector 1.51.0 catalog adapter mapped `id` `base1-58_en` (null `tcg_card_id`) and search `{ data: [...] }`. Phone taps still manual.

**Founder note (2026-09-21):** Mac LAN IP moved to `172.20.10.2` (old `10.0.0.43` unreachable). Gitignored `apps/mobile/.env` now uses `EXPO_PUBLIC_API_URL=http://172.20.10.2:3001`. Restart Expo after the change.

**Founder note (2026-09-21, later):** LAN IP is `10.0.0.43` again. Gitignored `apps/mobile/.env` matches (`EXPO_PUBLIC_API_URL=http://10.0.0.43:3001`). Metro restarted with those public URLs (`pnpm dev:mobile`, no localhost override). Paired **Sean’s iPhone (2)** (iPhone 15 Pro) opened Expo Go at `exp://10.0.0.43:8081`, but Expo Go on the phone is **SDK 57** and this project is **SDK 54** — the client refuses to load. A debug `expo run:ios --device` is blocked too: local Xcode **15.2**, React Native 0.81 needs **Xcode ≥ 16.1**. Phone CRM taps stay blocked until Expo Go matches (upgrade to SDK 57) or Xcode is new enough to install a debug build. Do not treat simulator as A2.

**Founder note (2026-09-22):** Mobile app upgraded to **Expo SDK 57** (`expo@~57.0.24`, RN 0.86.3) so it matches the phone’s Expo Go. LAN IP is `172.20.10.2` again; gitignored `apps/mobile/.env` uses `EXPO_PUBLIC_API_URL=http://172.20.10.2:3001`. Expo Go on **Sean’s iPhone (2)** now loads the project (`iOS Bundled`). First paint still requested `http://127.0.0.1:3001` because `Constants.isDevice` is false in Expo Go — LAN URL selection now uses the iOS simulator flag instead. Reload Expo Go, then scan → confirm → Max Buy.

**Founder note (2026-09-22, device Collection):** After the LAN URL fix, Collection on the phone shows **2 purchased / 0 watching**, estimate **$55.88**, two Base Pikachu `#58 EN` at all-in `$4.00` with Draft. That confirms device → LAN API reads. A2 still needs one **write** from the phone: Scan a card → confirm → Max Buy.

**Done when:** One purchased or watchlist write succeeds from the phone.

**Do not:** Treat simulator success as a substitute for A2 when shipping to device testers.

- [x] LAN API CRM write (scan → confirm → Max Buy → purchased) against device URL `http://10.0.0.43:3001`.
- [ ] Device CRM round-trip confirmed on phone (manual).

---

## Phase B — P2 PokeTrace (quick win)

**Why early:** One flag; key/URL often already in local `.env`. Code: [apps/api/src/poketrace-env.ts](../apps/api/src/poketrace-env.ts).

### Task B1 — Flip PokeTrace on

- In `apps/api/.env`:
  ```bash
  CARD_FLOW_POKETRACE_ENABLED=true
  # POKETRACE_API_KEY and POKETRACE_API_URL already set when configured
  ```
- Restart API (`pnpm dev:api`).
- Open Grading → Prepare on a copy with a known `tcgdex_id`.

**Founder note (2026-09-20):** Local `.env` had `POKETRACE_API_KEY` / `POKETRACE_API_URL` set and `CARD_FLOW_POKETRACE_ENABLED` empty. Flag flipped to `true`. Restart API and confirm Prepare slab rows + `/health` slab pricing mode.

**Founder note (2026-09-20, later):** Live OpenAPI has no `/cards/:id/graded-prices`. Adapter now searches `GET /cards` (name + US market, UUID detail) and normalizes host-only `POKETRACE_API_URL` to `https://api.poketrace.com/v1`. Key is present (`/health` → `slabPricing: "poketrace"`) but the PokeTrace plan is **Free**, so graded amounts stay empty (`source: "none"`, rows still PSA 8/9/10, BGS 9.5, CGC 10, TAG 10 with `—`). Upgrade the PokeTrace plan for live dollars. Never put the key on the device.

Touch: `apps/api/.env` (gitignored), [apps/api/src/poketrace-http.ts](../apps/api/src/poketrace-http.ts).

**Done when:** Prepare shows fail-soft slab rows (PSA 8/9/10, BGS 9.5, CGC 10, TAG 10) or honest empty when key missing; `/health` reflects slab pricing mode (`poketrace` when key present).

**Do not:** Put PokeTrace key on the device.

- [x] `CARD_FLOW_POKETRACE_ENABLED=true` in local API `.env`.
- [x] API `/health` → `slabPricing: "poketrace"` after restart.
- [x] LAN API `GET /v1/cards/base1-58/slab-estimates` → six Prepare rows (PSA 8/9/10, BGS 9.5, CGC 10, TAG 10); amounts empty on Free plan.
- [ ] Prepare slab rows confirmed in app after API restart (manual).

---

## Phase C — P1 CNN path (remaining smoke verify)

**Already complete:** upstream clone, venv, smoke `phase2_best.pth`, sidecar `:8091`, API `CARD_FLOW_GRADE_ESTIMATE_*` + `CARD_FLOW_PSA_GRADE_URL`. Sidecar: [services/psa-grade-predictor/](../services/psa-grade-predictor/).

### Task C1 — Confirm sidecar + API health

```bash
cd services/psa-grade-predictor && ./start.sh
curl -s http://127.0.0.1:8091/health   # expect ok: true
# Restart API, then:
curl -s http://127.0.0.1:3001/health   # expect gradeEstimate: "cnn"
```

**Done when:** Both health checks match.

- [x] Sidecar `/health` → `ok: true` (smoke checkpoint).
- [x] API `/health` → `gradeEstimate: "cnn"` with flag + PSA URL set.
- [x] Sidecar `POST /v1/estimate` front+back returns overall (smoke; not meaningful).

### Task C2 — Prepare with front + back (smoke)

- App: Grading → Prepare on a purchased copy with **front and back** photos.
- Expect non-null overall (smoke = **not** meaningful).
- Also confirm: front-only → empty estimate; sidecar stopped → empty estimate; Move to Submitted still works.

**Founder note (2026-09-21):** LAN API Prepare smoke on purchased `base1-58` (Pikachu): front+back → `provider: "cnn"`, `overall: 5` (untrained smoke — not meaningful), `usedBack: true`, `notACert: true`. Fresh copy front-only → empty (`overall: null`, `No estimate`). Sidecar stopped → empty estimate; `POST /v1/grading/submitted` still `201/200`. Sidecar restarted after the down check.

**Done when:** Fail-soft behavior matches the verification cheat sheet in [RUNTIME_CONFIG_PRIORITY.md](./RUNTIME_CONFIG_PRIORITY.md). Check off “Confirm Prepare…” there.

**Do not:** Trust smoke grades for buy/slab decisions.

- [x] LAN API Prepare front+back smoke estimate (`overall: 5`, not meaningful).
- [x] Front-only → empty; sidecar down → empty; Submitted still works.
- [ ] Prepare front+back smoke estimate confirmed in app (manual).

---

## Phase D — P1 alt Claude (usable interim)

Use when you want meaningful photo estimates **without** trained CNN weights. CNN wins whenever `CARD_FLOW_PSA_GRADE_URL` is set ([apps/api/src/grade-estimate-env.ts](../apps/api/src/grade-estimate-env.ts) → [grade-vision.ts](../apps/api/src/grade-vision.ts)).

### Task D1 — Switch API to vision mode

- Temporarily **unset** / comment out `CARD_FLOW_PSA_GRADE_URL`.
- Keep `CARD_FLOW_GRADE_ESTIMATE_ENABLED=true`.
- Set `ANTHROPIC_API_KEY` in `apps/api/.env` only (never Expo).
- Restart API → `/health` → `gradeEstimate: "vision"`.

**Founder note (2026-09-20):** Local `ANTHROPIC_API_KEY` is still empty. Do **not** clear `CARD_FLOW_PSA_GRADE_URL` until the Anthropic key is present — otherwise grades go off with no fallback. Steps below are ready; fill the key locally, then run D1–D2.

**Founder note (2026-09-21):** Rechecked gitignored `apps/api/.env`: `ANTHROPIC_API_KEY` still empty; `CARD_FLOW_GRADE_ESTIMATE_ENABLED=true` and `CARD_FLOW_PSA_GRADE_URL` still set. Left CNN on (`/health` → `gradeEstimate: "cnn"`). Did not unset the PSA URL.

**Founder note (2026-09-21, later):** `ANTHROPIC_API_KEY` set in gitignored `apps/api/.env`. Commented `CARD_FLOW_PSA_GRADE_URL`; API restart → `/health` `gradeEstimate: "vision"`. Sidecar may stay up but CNN is not selected while PSA URL is unset.

**Done when:** Health shows `vision`.

**Do not:** Expose Anthropic key to Expo / Settings / SecureStore.

- [x] `ANTHROPIC_API_KEY` set in local API `.env` (founder).
- [x] PSA URL unset and `/health` → `gradeEstimate: "vision"`.

### Task D2 — Prepare front+back with Claude

- Same Prepare flow as C2; expect a usable (non-smoke) estimate.
- Restore `CARD_FLOW_PSA_GRADE_URL=http://127.0.0.1:8091` when returning to sidecar testing.

**Founder note (2026-09-21):** D1 is live (`gradeEstimate: "vision"`). LAN Prepare front+back still returned empty because Anthropic rejected the key with `anthropic-workspace-id` required (identity-linked / not workspace-scoped). Code already sends `ANTHROPIC_WORKSPACE_ID` when set. Add that ID in gitignored `apps/api/.env` (or mint a workspace-scoped key), restart API, re-run Prepare.

**Founder note (2026-09-21, later):** `ANTHROPIC_WORKSPACE_ID` set; API restarted → still `gradeEstimate: "vision"`. Direct Anthropic Messages call with the workspace header now passes auth, but returns **credit balance too low**. Prepare front+back stays fail-soft empty (`overall: null`) until Plans & Billing has credits. No key leaked to the client.

**Founder note (2026-09-21, credits):** After credits were added, LAN `POST /v1/inventory/.../grade-estimate` with front+back stills returned `provider: "vision"`, `overall: 7` (`Estimate 7`, `notACert: true`, no key in response). PSA URL remains commented out. Restore `CARD_FLOW_PSA_GRADE_URL=http://127.0.0.1:8091` when returning to CNN sidecar testing.

**Done when:** Prepare shows a non-empty estimate with PSA URL unset; fail-soft still holds if key missing.

- [x] `ANTHROPIC_WORKSPACE_ID` set (or workspace-scoped key) so Claude accepts the request.
- [x] Anthropic account has API credits (Plans & Billing).
- [x] LAN API Prepare front+back with Claude returns non-null overall (`Estimate 7`).
- [ ] Prepare front+back with Claude confirmed (manual).

---

## Phase E — P1 PokéCollector (optional live prices)

Only if TCGdex catalog/pricing is not enough. Scripts: [infra/pokecollector/up.sh](../infra/pokecollector/up.sh); env: [apps/api/src/pokecollector-env.ts](../apps/api/src/pokecollector-env.ts).

### Task E1 — Bring stack up

```bash
# Copy infra/pokecollector/.env.example → infra/pokecollector/.env if needed (secrets local only)
pnpm pokecollector:up
pnpm pokecollector:health   # expect status: ok on :8000
```

**Done when:** Health endpoint OK.

- [x] PokéCollector compose up + health OK on `:8000`.

### Task E2 — Point API at PokéCollector

- In `apps/api/.env`:
  ```bash
  CARD_FLOW_POKECOLLECTOR_URL=http://127.0.0.1:8000
  ```
- Restart API; confirm catalog prefers PokéCollector over TCGdex when enabled.
- Spot-check collection/pricing in app.

**Done when:** Live prices/collection paths hit PokéCollector; CRM still works if you later unset URL (TCGdex fallback).

**Do not:** Require PokéCollector for core CRM.

- [x] `CARD_FLOW_POKECOLLECTOR_URL=http://127.0.0.1:8000` in local API `.env`.
- [x] API `/health` → `catalog: "pokecollector"` / `pricingProvider: "pokecollector"` after restart.
- [ ] App spot-check collection/pricing after API restart (manual).

---

## Phase F — P2 HUDS overlay chrome

Optional livestream chrome. [infra/huds/up.sh](../infra/huds/up.sh); mobile [apps/mobile/lib/huds.ts](../apps/mobile/lib/huds.ts).

### Task F1 — Start HUDS locally

```bash
pnpm huds:up
pnpm huds:health
# Overlay: http://127.0.0.1:9999/overlay/
```

**Done when:** Overlay loads; push events fail-soft if later stopped.

- [x] HUDS up + health OK; overlay reachable on `:9999`.
- [x] HUDS kept alive via durable background process (restart with `pnpm huds:up` if port 9999 drops).

### Task F2 — Device HUDS URL (if testing on phone)

- In gitignored `apps/mobile/.env`:
  ```bash
  EXPO_PUBLIC_HUDS_URL=http://<lan-ip>:9999
  ```
- Restart Expo.

**Founder note (2026-09-20):** Same LAN IP as A1 — `EXPO_PUBLIC_HUDS_URL=http://10.0.0.43:9999` added to mobile `.env`.

**Founder note (2026-09-22):** HUDS was bound to `127.0.0.1`, so the phone’s `EXPO_PUBLIC_HUDS_URL=http://172.20.10.2:9999` could not load the overlay (native “Scanner off” strip only). `infra/huds/up.sh` now defaults to `0.0.0.0`. Restart with `pnpm huds:down && pnpm huds:up` after the change. Overlay chrome sits over the live page (Estimate / Max Buy / Grade slots). Grade stays `—` / not a cert on this tab.

**Done when:** Watch/livestream overlay chrome reaches HUDS from device (or you only use simulator and leave this unchecked).

- [x] Mobile `.env` includes LAN HUDS URL.
- [ ] Device overlay confirmed on phone (manual).

---

## Phase G — P3 Live identity ONNX / CardSight

### Task G1 — CardSight / reserved ONNX stay empty; OpenCLIP is the visual path

- Leave `CARD_FLOW_LIVE_IDENTITY_ONNX_PATH` empty.
- Do not enable leftover CardSight vars for Capture/live product path.
- Livestream visual identity is the OpenCLIP sidecar ([docs/LIVE_VISUAL_MODEL.md](./LIVE_VISUAL_MODEL.md)) + pHash fallback — not CardSight, not PokéCollector Gemini.

**Founder note (2026-09-20):** Confirmed local `.env` leaves `CARD_FLOW_LIVE_IDENTITY_ONNX_PATH` and CardSight vars empty. No runtime change.

**Founder note (2026-09-23):** Chose [pokemon-scanner](https://github.com/t-sinclair2500/pokemon-scanner) OpenCLIP+HNSW over PokéCollector Gemini for livestream. Sidecar: `services/live-identity-openclip/`. Wire with `CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL`. Native build still required for real in-stream crops.

**Done when:** CardSight / reserved ONNX stay empty; OpenCLIP path is documented and fail-soft.

- [x] Live identity ONNX / CardSight left empty (intentional).
- [x] OpenCLIP livestream sidecar scaffolded (pokemon-scanner pipeline).

---

## Phase H — Train real CNN weights (later)

Blocked on obtaining/training `phase2_best.pth` (upstream [PSAGradePredictor](https://github.com/jshan9078/PSAGradePredictor) is training-only; no public license/weights).

1. Follow upstream README / Vertex AI deployment docs: upload splits + card pairs.
2. Train CORAL dual-branch (front ResNet-18 / back ResNet-34, 384px).
3. Download `phase2_best.pth` → replace smoke file at `services/psa-grade-predictor/checkpoints/phase2_best.pth`.
4. Restart sidecar; re-run Tasks C1–C2.
5. Trust Prepare grades only after this.

**Done when:** Trained checkpoint loads; Prepare grades are meaningful; priority doc “Replace smoke `.pth`…” checkbox cleared.

**Do not:** Commit the checkpoint. Vendor upstream training source into `apps/` or `packages/`.

- [ ] Trained `phase2_best.pth` installed (replaces smoke).
- [ ] Prepare grades re-verified and trusted.

---

## Out of scope

- New feature code for Capture/CRM (already operational).
- Vendoring PSAGradePredictor into CardFlow source.
- Committing checkpoints, compose secrets, or API keys.
