# Runtime config priority

Local setup checklist for PokeSniper features that are implemented in code but still need env / services / weights before they are fully operational.

**Task checklist (one at a time):** [RUNTIME_CONFIG_TASKS.md](./RUNTIME_CONFIG_TASKS.md)

**Last reviewed:** 2026-09-20  
**Machine note:** Capture OBB+pHash, SQLite, offline cardgrading (OpenCV, no CNN or Claude), PokeTrace flag (Free plan = empty graded amounts), PokéCollector URL + live 1.51.0 catalog adapter, and HUDS are wired locally. Mobile is **Expo SDK 57**; Expo Go on the paired iPhone loads Collection (2 purchased Pikachu, estimate $55.88) from the LAN API. Remaining gaps: one CRM **write** from the phone (scan → confirm → Max Buy), device Prepare confirm, trained CNN weights, PokeTrace Pro for live slab dollars.

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
| **P1** | PokéCollector live prices / collection | `CARD_FLOW_POKECOLLECTOR_URL` + `infra/pokecollector/up.sh` | No if TCGdex is enough |
| **P2** | PokeTrace slab comps on Prepare | Flip `CARD_FLOW_POKETRACE_ENABLED=true` (key/URL may already be set) | No |
| **P2** | HUDS overlay chrome | `infra/huds/up.sh` (+ device HUDS URL if needed) | No |
| **P2** | Livestream OpenCLIP visual identity | Sidecar up (`pnpm live-identity:up`) and `CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL`. `/health` `liveIdentityVisual` shows `openclip` or `phash`. Native dev client is last ([REMAINING_TASKS.md](./REMAINING_TASKS.md) P1-2). | No |
| **P3** | Live identity ONNX / CardSight | Leave empty — OpenCLIP + pHash is the livestream path | No |

**Suggested order:** P0 (if testing on phone) → P2 PokeTrace (one flag) → PokéCollector only if you need live market prices beyond TCGdex → P2 OpenCLIP livestream (after native build).

Photo pre-grade is the vendored OpenCV library only. The CNN sidecar and the Claude grade fallback are removed.

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
| `GET /health` | `gradeEstimate: "cardgrading"` when Python and the vendor library are present |
| Prepare + front/back | A pre-grade estimate from the offline library, or a retake |
| Prepare + front only | Empty estimate |
| Grade flag false | Empty estimate; Move to Submitted still works |
