# Livestream visual model — decision

**Last reviewed:** 2026-09-24  
**Job:** Name the English card in the in-stream Whatnot / eBay video (`tcgdex_id`) for the HUD. Not Capture. Not inventory.  
**Execute next:** [LIVE_IDENTITY_OPENCLIP_TASKS.md](./LIVE_IDENTITY_OPENCLIP_TASKS.md) (one task at a time).  
**Flat checklist:** [LIVE_IDENTITY_OPENCLIP_STEPS.md](./LIVE_IDENTITY_OPENCLIP_STEPS.md).

## Compared candidates

| Repo | What it is | Fit for livestream |
|------|------------|--------------------|
| [Git-Romer/pokecollector](https://github.com/Git-Romer/pokecollector) | Collection CRM + **Gemini / OpenAI vision** still-photo scanner (AGPL) | **No.** Cloud LLM on uploaded stills, high latency, AGPL source must not be copied, and [ROADMAP.md](./ROADMAP.md) forbids PokéCollector Gemini on this tab. Keep unmodified GHCR **only** for catalog / USD estimates over HTTP. |
| [t-sinclair2500/pokemon-scanner](https://github.com/t-sinclair2500/pokemon-scanner) | MIT OpenCV + **OpenCLIP ViT-B/32** + HNSW + ORB re-rank + OCR fallback | **Yes (pipeline).** Local visual index, works offline after index build, designed for card crops. Webcam/CSV UI is theirs — we do not ship their CLI or camera product. |

## Decision

**Use the pokemon-scanner visual pipeline** (OpenCLIP embeddings + ANN index) as CardFlow’s livestream identity model.

**Do not** use PokéCollector recognition / Gemini for livestream.

CardFlow owns a sidecar under `services/live-identity-openclip/` that:

1. Builds an English **TCGdex** art index (`tcgdex_id` keys — not pokemontcg.io ids).
2. Accepts a **card crop JPEG** from in-stream sample buffers (never a page screenshot).
3. Returns ranked `tcgdex_id` candidates.
4. Stays fail-soft when the sidecar / index is down → existing **RGB pHash** path remains the fallback.

Native `CardFlowLiveVideo` still detects the card in the live page video. Expo Go cannot run that module — a **dev client / native build** is still required for real Whatnot frames.

## End-to-end data flow

```text
In-app live page video
  → native detect + crop (identityCropJpeg + identityRgb)
  → POST /v1/livestream/identify
  → OpenCLIP sidecar (prefer) or pHash index (fallback)
  → stabilize (2 hits) → overlay guess (no inventory write)
```

## Scaffold vs remaining work

| Already in tree | Still required (see tasks doc) |
|-----------------|--------------------------------|
| Sidecar + smoke/full index scripts | Local venv, smoke up, full TCGdex index |
| API prefer-OpenCLIP + tests | `CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL` in API `.env` |
| Native JPEG crop emission | Dev client / Xcode 16.1+ or EAS install on phone |
| pHash fallback | ORB re-rank (Phase C), device QA (Phase E) |

## Non-goals

- Vendoring PokéCollector or pokemon-scanner source trees into `apps/` or `packages/`.
- Putting Gemini / OpenCLIP / PokeTrace keys on the phone.
- Identifying from WebView screenshots or the device camera as the product path.
- Replacing PokéCollector HTTP catalog/pricing with pokemon-scanner CSV pricing.
- Replacing Capture OBB + pHash with OpenCLIP (Capture stays the TCGP-scanner pipeline).
