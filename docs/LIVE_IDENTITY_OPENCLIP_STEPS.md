# Livestream OpenCLIP identity — step list

**Model:** [pokemon-scanner](https://github.com/t-sinclair2500/pokemon-scanner) pipeline (OpenCLIP + HNSW), CardFlow-owned sidecar.  
**Not:** PokéCollector Gemini.  
**Detail / Done when / Do not:** [LIVE_IDENTITY_OPENCLIP_TASKS.md](./LIVE_IDENTITY_OPENCLIP_TASKS.md)  
**Decision:** [LIVE_VISUAL_MODEL.md](./LIVE_VISUAL_MODEL.md)

Do these **in order**. Check each box when finished.

---

## Phase 0 — Premises

- [x] **0.1** Confirm constraints: in-stream frames only; `tcgdex_id` index keys; native/dev client required (not Expo Go); no Gemini, view-shot, or phone-camera product path.

---

## Phase A — Sidecar ready for local API

- [x] **A1** Create Python venv and install `services/live-identity-openclip/requirements.txt`.
- [x] **A2** Build smoke index (`build_smoke_index.py`), run `pnpm live-identity:up`, confirm `/health` OK.
- [x] **A3** Set `CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL=http://127.0.0.1:8092` in gitignored `apps/api/.env`; restart API; confirm boot log shows OpenCLIP on.
- [x] **A4** Verify API crop round-trip (`identityCropJpeg` → OpenCLIP prefer path; pHash fallback when URL unset).

---

## Phase B — Full English visual index

- [x] **B1** *(300-card first pass; full index pending)* Build full TCGdex OpenCLIP index (`build_tcgdex_index.py --out data/index`); point `LIVE_IDENTITY_INDEX` at it; restart sidecar; confirm a known crop (e.g. `base1-58`) accepts.
- [ ] **B2** Tune `LIVE_IDENTITY_ACCEPT` if needed; bind sidecar for LAN only via API (phone never talks to OpenCLIP directly).

---

## Phase C — Accuracy (pokemon-scanner parity)

- [ ] **C1** Add ORB re-rank on HNSW top-K (fail-soft if ORB fails).
- [ ] **C2** OCR fallback only if still needed on clear upright cards; otherwise defer (livestream blur).

---

## Phase D — Native build (real Whatnot frames)

- [ ] **D1** Choose tooling: Xcode ≥ 16.1 for local `expo run:ios`, **or** EAS development build.
- [ ] **D2** Dev client with `cardflow-live-video` + Capgo; prebuild; install on physical iPhone (then Android).
- [ ] **D3** Scanner ON on live show: `cardDetected: true` and API receives `identityCropJpeg` and/or `identityHash` (no view-shot / Capture).

---

## Phase E — End-to-end QA

- [ ] **E1** Two stable hits → HUD shows name + Estimate + Max Buy + Grade `—`; guess does not write inventory.
- [ ] **E2** Fail-soft matrix: scanner off; looking; sidecar down; missing index; Whatnot↔eBay switch; Confirm leftover.
- [ ] **E3** Measure latency (target OpenCLIP p95 &lt; 400 ms or document honest number); no WebView stutter.

---

## Phase F — Docs / ops

- [ ] **F1** Make OpenCLIP vs pHash visible to operators (`/health` field and/or documented boot log).
- [ ] **F2** Keep [RUNTIME_CONFIG_PRIORITY.md](./RUNTIME_CONFIG_PRIORITY.md) aligned with this path.

---

## Suggested order (short)

1. A1 → A2 → A3 → A4  
2. B1 → B2  
3. C1 (C2 only if needed)  
4. D1 → D2 → D3  
5. E1 → E2 → E3  
6. F1 → F2  

**Do not** treat Expo Go / simulator as Phase E success. **Do not** start Phase C before A–B.
