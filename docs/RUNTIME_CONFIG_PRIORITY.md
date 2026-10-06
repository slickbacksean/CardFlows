# Runtime config priority

Local setup checklist for CardFlow features that are implemented in code but still need env / services / weights before they are fully operational.

**Task checklist (one at a time):** [RUNTIME_CONFIG_TASKS.md](./RUNTIME_CONFIG_TASKS.md)

**Last reviewed:** 2026-09-20  
**Machine note:** Capture OBB+pHash, SQLite, CNN smoke sidecar, Claude vision interim on (`gradeEstimate: "vision"`; LAN Prepare returned `Estimate 7`), PokeTrace flag (Free plan = empty graded amounts), PokéCollector URL + live 1.51.0 catalog adapter, and HUDS are wired locally. Mobile is **Expo SDK 57**; Expo Go on the paired iPhone loads Collection (2 purchased Pikachu, estimate $55.88) from the LAN API. Remaining gaps: one CRM **write** from the phone (scan → confirm → Max Buy), device Prepare confirm, trained CNN weights, PokeTrace Pro for live slab dollars.

Never put API keys or tokens in this file. Keep secrets in gitignored `apps/api/.env` only.

---

## Already operational (no action)

| Capability | Notes |
|---|---|
| Capture OBB + pHash | `CARD_FLOW_OBB_PHASH_ENABLED=true`, ONNX + index on disk, AGPL accepted |
| TCGdex catalog | Default on when PokéCollector URL is unset |
| SQLite store + local session | Empty store vars → gitignored SQLite; non-prod auto-session |
| Livestream identity (current) | OpenCLIP preferred when `CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL` is set, else English pHash. `/health` `liveIdentityVisual` is `openclip`, `phash`, or `off`. ORB re-ranks near-ties. A native dev client is still required for a live show — [REMAINING_TASKS.md](./REMAINING_TASKS.md) P1-2. |

---

## Priority list

| Priority | Item | What’s missing | Blocks core CRM? |
|---|---|---|---|
| **P0** | Device ↔ API reachability | On a real phone: `EXPO_PUBLIC_API_URL=http://<lan-ip>:3001` (simulator defaults to localhost) | Yes on device |
| **P1** | **CNN photo estimate** (Grading → Prepare) | Upstream clone + **trained** `phase2_best.pth` + sidecar running + `CARD_FLOW_GRADE_ESTIMATE_ENABLED=true` + `CARD_FLOW_PSA_GRADE_URL` | No (Prepare stays mock/empty) |
| **P1 alt** | Claude grade fallback | `ANTHROPIC_API_KEY` + grade flag on (used only when PSA URL is unset) | No |
| **P1** | PokéCollector live prices / collection | `CARD_FLOW_POKECOLLECTOR_URL` + `infra/pokecollector/up.sh` | No if TCGdex is enough |
| **P2** | PokeTrace slab comps on Prepare | Flip `CARD_FLOW_POKETRACE_ENABLED=true` (key/URL may already be set) | No |
| **P2** | HUDS overlay chrome | `infra/huds/up.sh` (+ device HUDS URL if needed) | No |
| **P2** | Livestream OpenCLIP visual identity | Sidecar up (`pnpm live-identity:up`) and `CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL`. `/health` `liveIdentityVisual` shows `openclip` or `phash`. Native dev client is last ([REMAINING_TASKS.md](./REMAINING_TASKS.md) P1-2). | No |
| **P3** | Live identity ONNX / CardSight | Leave empty — OpenCLIP + pHash is the livestream path | No |

**Suggested order:** P0 (if testing on phone) → P2 PokeTrace (one flag) → P1 CNN (or Claude interim) → PokéCollector only if you need live market prices beyond TCGdex → P2 OpenCLIP livestream (after native build).

---

## P1 — CNN path (detailed)

Upstream: [jshan9078/PSAGradePredictor](https://github.com/jshan9078/PSAGradePredictor)  
CardFlow sidecar: [services/psa-grade-predictor/README.md](../services/psa-grade-predictor/README.md)

### Blocker

The public repo is **training-only**: no license, no shipped weights. Real grades need your own Vertex/GCS training run (or another obtained `phase2_best.pth`).

Until a real checkpoint exists:

- A **smoke** checkpoint (untrained) can verify wiring end-to-end; estimates are **not** meaningful.
- Or use **P1 alt** Claude for usable photo estimates.

### Steps (real or smoke weights)

1. Clone upstream (sidecar imports it; not vendored into CardFlow source):
   ```bash
   git clone https://github.com/jshan9078/PSAGradePredictor.git \
     services/psa-grade-predictor/upstream
   ```
2. Place weights at `services/psa-grade-predictor/checkpoints/phase2_best.pth`  
   (smoke: `python scripts/make_smoke_checkpoint.py` from the sidecar dir).
3. Start sidecar:
   ```bash
   cd services/psa-grade-predictor
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   export PSA_GRADE_UPSTREAM="$(pwd)/upstream"
   export PSA_GRADE_CHECKPOINT="$(pwd)/checkpoints/phase2_best.pth"
   python serve.py
   ```
4. Confirm `curl -s http://127.0.0.1:8091/health` → `"ok": true`.
5. In `apps/api/.env`:
   ```bash
   CARD_FLOW_GRADE_ESTIMATE_ENABLED=true
   CARD_FLOW_PSA_GRADE_URL=http://127.0.0.1:8091
   CARD_FLOW_PSA_GRADE_TOKEN=
   CARD_FLOW_PSA_GRADE_TIMEOUT_MS=30000
   ```
6. Restart API. `GET /health` → `"gradeEstimate": "cnn"`.
7. App: Grading → Prepare on a purchased copy with **front and back** photos.  
   Front-only or sidecar down → empty estimate (fail soft).

### Local progress (2026-09-20)

- [x] Priority doc created
- [x] Upstream cloned to `services/psa-grade-predictor/upstream` (gitignored)
- [x] Sidecar venv + deps installed
- [x] Smoke (untrained) checkpoint written
- [x] Sidecar healthy on `:8091` (`./start.sh`)
- [x] `apps/api/.env` wired for CNN (restart API → `/health` should show `gradeEstimate: "cnn"`)
- [x] Sidecar `POST /v1/estimate` front+back smoke returns overall (untrained — not meaningful)
- [x] Confirm Prepare on device/simulator with front+back photos
- [ ] Replace smoke `.pth` with a trained checkpoint before trusting grades

### Train real weights (later)

See [RUNTIME_CONFIG_TASKS.md](./RUNTIME_CONFIG_TASKS.md) Phase H. Follow upstream README / Vertex AI deployment docs: upload splits + card pairs, train CORAL dual-branch (front ResNet-18 / back ResNet-34, 384px), download `phase2_best.pth`, replace the smoke checkpoint, restart sidecar.

---

## P2 — PokeTrace (quick)

```bash
CARD_FLOW_POKETRACE_ENABLED=true
# POKETRACE_API_KEY and POKETRACE_API_URL already in .env when configured
```

Restart API. Prepare shows fail-soft PSA 8/9/10, BGS 9.5, CGC 10, TAG 10 rows.

---

## Verification cheat sheet

| Check | Expect |
|---|---|
| `GET /health` | `gradeEstimate: "cnn"` when flag + URL set |
| Sidecar `/health` | `ok: true` when checkpoint loads |
| Prepare + front/back | Non-null overall (smoke = meaningless; real = trained) |
| Prepare + front only | Empty estimate |
| Sidecar stopped | Empty estimate; Move to Submitted still works |
