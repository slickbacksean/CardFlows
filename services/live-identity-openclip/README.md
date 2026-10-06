# CardFlow livestream identity — OpenCLIP sidecar

Pipeline inspired by [t-sinclair2500/pokemon-scanner](https://github.com/t-sinclair2500/pokemon-scanner) (**MIT**): OpenCLIP ViT-B/32 embeddings + HNSW cosine search.

CardFlow does **not** vendor that repo. Index keys are English **`tcgdex_id`** (TCGdex art), not pokemontcg.io ids. PokéCollector Gemini is never used here.

## Setup

```bash
cd services/live-identity-openclip
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Smoke index (tiny fixture — enough to wire the API):
python scripts/build_smoke_index.py

# Full English index in set-grouped batches (~2000 cards each; resumable; gitignored):
# python scripts/build_tcgdex_batches.py plan      # groups whole sets in release order
# python scripts/build_tcgdex_batches.py build --next   # or: build 3 4; retries skipped art in slower passes
# python scripts/build_tcgdex_batches.py status
# python scripts/build_tcgdex_batches.py merge [--partial]   # -> data/index
#
# Quick single-shot index (small passes only; Pocket art is always excluded):
# python scripts/build_tcgdex_index.py --out data/index --limit 300 --sets base1,base2,base3,base4

export LIVE_IDENTITY_INDEX="$(pwd)/data/smoke-index"
# optional: export LIVE_IDENTITY_TOKEN=dev-shared-secret
python serve.py
```

Or from the repo root: `pnpm live-identity:up` (detached; logs to `live-identity.log`; waits up to `LIVE_IDENTITY_WAIT_SECS`, default 240, for model load).

Health: `GET http://127.0.0.1:8092/health` (includes the active `accept` / `margin` gate)  
Match: `POST http://127.0.0.1:8092/v1/match` multipart field `crop` (JPEG/PNG of the card region)

Accept gate: top-1 similarity ≥ `LIVE_IDENTITY_ACCEPT` (default `0.86`) **and** top-1 − top-2 ≥ `LIVE_IDENTITY_MARGIN` (default `0.02`). A near-tie is re-ranked with ORB inliers when a local reference image exists (`LIVE_IDENTITY_REF_DIR`, or `images/` next to the index, or `../images`). Missing OpenCV or a missing image keeps the cosine order. Responses carry `reason`: `accepted`, `below_threshold`, or `ambiguous`, plus `orb`: `orb` or `cosine`. `/health` reports `matchP50Ms` and `matchP95Ms` for recent matches. Re-tune on the built index with `python scripts/eval_accept.py`.

## Wire into CardFlow API

```bash
# apps/api/.env
CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL=http://127.0.0.1:8092
CARD_FLOW_LIVE_IDENTITY_OPENCLIP_TOKEN=dev-shared-secret   # if set on the sidecar
```

When the URL is set and the mobile/native path posts `identityCropJpeg`, `/v1/livestream/identify` prefers OpenCLIP. Otherwise it keeps the RGB pHash index.

CI stays on pHash fixtures / mocks. Fail soft: sidecar down → pHash (or unidentified).