# Railway Volume Setup for Trained Model

## Overview

**Ship config** is three-model DINOv2 fusion (`r18h×2 + d + e`) plus the extended 20339-ID catalog and optional printing reranker. Upload the whole ship `bundle/` to the volume and **keep relative paths stable**. Weights, catalogs, `fam.json`, and `hr_cat/` are not in git.

Approximate disk: 3 × 148 MB weights + 6 × 16 MB catalogs + 284 MB `hr_cat` ≈ **830 MB**. Use a **2 GB** volume.

These files can be provided via:
1. **Railway Persistent Volume** (recommended for faster cold starts)
2. **Public URL** (auto-downloaded on startup, cached locally)

Rollback: the sidecar still loads the legacy single `TRAINED_MODEL_WEIGHTS` / `_CAT_*` path when fusion env is incomplete.

## Railway service settings (`live-identity-openclip`)

Create a **separate** Railway service for the sidecar (do not bake models into the API image). Configure it in the Railway dashboard — do **not** add `railway.json` / `railway.toml` (deprecated; new services cannot use them).

| Setting | Value |
|---|---|
| Service name | `live-identity-openclip` |
| Root directory | `services/live-identity-openclip` |
| Builder | Dockerfile (`Dockerfile` in that root) |
| Watch / deploy branch | `main` (or the branch Sean approves) |
| Healthcheck path | `/health` |
| Healthcheck timeout | ≥ 120 s (torch import on cold start) |
| Public networking | off (private only) |
| Internal port | `8080` (`PORT` / `LIVE_IDENTITY_PORT`) |
| Volume mount | `/data/trained-model` |
| Volume size | **2 GB** (ship bundle ≈ 830 MB + working space) |
| Memory | ≥ 2 GB (fusion RSS ≈ 1.2–1.8 GB) |

On the **API** service, point recognition at the private DNS name (Railway internal networking):

```bash
CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL=http://live-identity-openclip.railway.internal:8080
```

Optional shared secret (set the same value on both services; never commit it):

```bash
CARD_FLOW_LIVE_IDENTITY_OPENCLIP_TOKEN=<shared>
LIVE_IDENTITY_TOKEN=<shared>
```

`/health` returns **HTTP 200** even when the ship bundle is not on the volume yet (`ok: false`, `modelsPresent: false`, `fusionLoaded: false`, `printRerank: false`, plus an `error` string). That lets the first deploy pass the healthcheck before you upload models. After upload + env vars, `/health` should report `ok: true`, `pipeline: "trained_dinov2_fusion"`, `printRerank: true`.

## Option 1: Railway Persistent Volume (Recommended)

### Step 1: Create Volume in Railway

1. Open your Railway project
2. Go to your service (e.g., `live-identity-openclip`)
3. Click "Variables" tab
4. Click "New Volume"
5. Set mount path: `/data/trained-model`
6. Size: **2 GB** (ship bundle ≈ 830 MB plus working space)

### Step 2: Upload the ship bundle

Keep this relative layout (do not flatten it):

```
/data/trained-model/bundle/
  MANIFEST.json
  SIZES.tsv
  models/
    r18h/b1_best.pt
    d/b1_best.pt
    e/b1_best.pt
  catalog/
    cat_ids.json
    catx_names.json
    h/cat_full_b1.npy
    h/cat_art_b1.npy
    d/cat_full_b1.npy
    d/cat_art_b1.npy
    e/cat_full_b1.npy
    e/cat_art_b1.npy
  reranker/
    model_frozen.json
    fam.json
    hr_cat/*.jpg
```

Railway volumes are attached to running services. Upload files via:

**Method A: Using Railway CLI**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Copy the local ship bundle onto the volume (keep relative paths)
railway run bash -c "
  mkdir -p /data/trained-model/bundle && \
  # from a machine that already has ship1105/bundle/:
  cp -a /workspace/ship1105/bundle/. /data/trained-model/bundle/
"
```

**Method B: Using a One-Time Upload Container**

1. Deploy a simple uploader service:
```python
# upload.py
from fastapi import FastAPI, UploadFile, File
from pathlib import Path

app = FastAPI()

@app.post("/upload/{filename}")
async def upload(filename: str, file: UploadFile = File(...)):
    path = Path("/data/trained-model") / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        f.write(await file.read())
    return {"ok": True, "path": str(path), "size": path.stat().st_size}
```

2. Deploy it, upload files via HTTP POST, then remove the service

**Method C: Using Shell Access**

1. SSH into your Railway service (if available)
2. `mkdir -p /data/trained-model`
3. `curl` or `wget` the files from your S3/CDN

### Step 3: Set Environment Variables

In Railway service environment variables. Paths are relative to the uploaded `bundle/`:

```bash
BUNDLE=/data/trained-model/bundle

# Ship fusion (r18h×2 + d + e)
TRAINED_MODEL_FUSION=r18h2de
TRAINED_MODEL_H_WEIGHTS=$BUNDLE/models/r18h/b1_best.pt
TRAINED_MODEL_D_WEIGHTS=$BUNDLE/models/d/b1_best.pt
TRAINED_MODEL_E_WEIGHTS=$BUNDLE/models/e/b1_best.pt
TRAINED_MODEL_H_CAT_FULL=$BUNDLE/catalog/h/cat_full_b1.npy
TRAINED_MODEL_H_CAT_ART=$BUNDLE/catalog/h/cat_art_b1.npy
TRAINED_MODEL_D_CAT_FULL=$BUNDLE/catalog/d/cat_full_b1.npy
TRAINED_MODEL_D_CAT_ART=$BUNDLE/catalog/d/cat_art_b1.npy
TRAINED_MODEL_E_CAT_FULL=$BUNDLE/catalog/e/cat_full_b1.npy
TRAINED_MODEL_E_CAT_ART=$BUNDLE/catalog/e/cat_art_b1.npy
TRAINED_MODEL_CAT_IDS=$BUNDLE/catalog/cat_ids.json
TRAINED_MODEL_CATX_NAMES=$BUNDLE/catalog/catx_names.json
TRAINED_MODEL_FUSION_WEIGHTS=2,1,1
TRAINED_MODEL_ACCEPT=0.68
TRAINED_MODEL_MARGIN=0.02
TRAINED_MODEL_OCR_W=0.15
TRAINED_MODEL_NUM_W=0.10

# Printing reranker (override only when p > 0.9)
PRINT_RERANK_ENABLED=1
PRINT_RERANK_MODEL=$BUNDLE/reranker/model_frozen.json
PRINT_RERANK_FAM=$BUNDLE/reranker/fam.json
PRINT_RERANK_HR_CAT=$BUNDLE/reranker/hr_cat
PRINT_RERANK_THRESHOLD=0.9
PRINT_RERANK_TOPK_SAME_NAME=6
```

Railway does not expand `$BUNDLE` in the dashboard — paste the full `/data/trained-model/bundle/...` paths.

**Rollback (legacy single model):** leave `TRAINED_MODEL_FUSION` unset and point the original four vars at one checkpoint + catalog pair. Accept/margin stay `0.68` / `0.02`.

### Step 4: Verify

After deployment, check `/health`:
```bash
curl https://your-railway-url/health
```

Ship fusion should return:
```json
{
  "ok": true,
  "pipeline": "trained_dinov2_fusion",
  "model": "dinov2_s_r18h2de",
  "indexed": 20339,
  "printRerank": true
}
```

Legacy single-model rollback reports `"pipeline": "trained_dinov2"`.

## Option 2: Public URLs (Auto-Download)

If you can't use volumes, host files on S3/CDN and provide URLs:

```bash
# Railway environment variables
TRAINED_MODEL_WEIGHTS=https://your-s3-bucket.../b1_best.pt
TRAINED_MODEL_CAT_FULL=https://your-s3-bucket.../cat_full_b1.npy
TRAINED_MODEL_CAT_ART=https://your-s3-bucket.../cat_art_b1.npy
TRAINED_MODEL_CAT_IDS=https://your-s3-bucket.../cat_ids.json

# Optional: custom cache dir (defaults to .cache/trained-model)
TRAINED_MODEL_CACHE_DIR=/tmp/model-cache
```

**Pros**:
- Simple setup (just set env vars)
- No volume management

**Cons**:
- Downloads on every cold start (~500 MB, 1-2 minutes)
- Uses ephemeral disk (lost on redeploy)
- Increases startup latency

## Option 3: Embed in Docker Image (Not Recommended)

You can bake files into the Docker image, but:
- Large image size (~1 GB)
- Slow builds and deployments
- Hard to update weights without rebuilding

Only use if you deploy rarely and want guaranteed availability.

## Fallback to OpenCLIP

If fusion env is incomplete, the sidecar falls back to the legacy single `TRAINED_MODEL_*` path when those four files exist. If that is also incomplete, it uses OpenCLIP. Check `/health`:

```json
{
  "pipeline": "trained_dinov2_fusion"  // ship fusion
}
```

```json
{
  "pipeline": "trained_dinov2"  // legacy single-model rollback
}
```

```json
{
  "pipeline": "openclip_hnsw"  // OpenCLIP fallback
}
```

A corrupt h/d/e weight file **refuses fusion** (no 2/3 partial fuse) and then follows the same fallback. Missing reranker files keep fusion-only (warning, no crash). Catalog ID count ≠ 20339 or npy shape mismatch refuses fusion start.

## Troubleshooting

### "Model file not found"

Check:
1. Volume is mounted at `/data/trained-model`
2. Bundle exists: `ls -lh /data/trained-model/bundle/models/r18h /data/trained-model/bundle/catalog`
3. Permissions are readable
4. Env vars point to correct paths

### "Failed to load model"

Check:
1. PyTorch can load checkpoint: `torch.load(path, map_location='cpu')`
2. NumPy files are valid: file size > 0
3. JSON is valid: `python -m json.tool cat_ids.json`
4. Sufficient memory (need ~1 GB RAM for model + embeddings)

### Slow Cold Starts

If using URLs:
1. Switch to Railway volume
2. Or use a CDN closer to Railway's region
3. Or enable Railway's build cache

### Out of Memory

Three fusion models on CPU need about **1.2–1.8 GB** RSS. A single-model rollback is ~500–700 MB. If OOM:
1. Upgrade Railway plan (Starter → Pro)
2. Or use ONNX export (slightly smaller memory footprint)
3. Or filter catalog to fewer cards

## Cost Optimization

**Railway Starter ($5/mo)**:
- 512 MB RAM: May OOM under load
- Shared CPU: 200-400ms latency
- 1 GB volume included

**Railway Pro ($20/mo)**:
- 2 GB RAM: Comfortable headroom
- More CPU: 100-200ms latency
- 10 GB volume included

Recommendation: Start with **Starter + volume**, upgrade to Pro if OOM or latency issues.

## Future: ONNX Export

For even faster cold starts and lower memory:
```bash
# Export to ONNX (requires PyTorch locally)
python scripts/export_onnx.py \
  --weights /path/to/b1_best.pt \
  --output b1_dinov2.onnx \
  --check

# Deploy ONNX version
TRAINED_MODEL_WEIGHTS=https://your-s3.../b1_dinov2.onnx
```

ONNX benefits:
- ~30-50% smaller file size
- ~20-40% faster inference
- Lower memory footprint
- Better CPU optimization

See `scripts/export_onnx.py` for details.
