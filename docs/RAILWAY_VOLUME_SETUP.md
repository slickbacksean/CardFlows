# Railway Volume Setup for Trained Model

## Overview

The trained DINOv2-S model requires ~400-500 MB of files:
- **b1_best.pt**: PyTorch checkpoint (~148 MB)
- **cat_full_b1.npy**: Full-card catalog embeddings (~50-100 MB)
- **cat_art_b1.npy**: Art-crop catalog embeddings (~50-100 MB)
- **cat_ids.json**: TCGdex ID mapping (~100 KB)

These files can be provided via:
1. **Railway Persistent Volume** (recommended for faster cold starts)
2. **Public URL** (auto-downloaded on startup, cached locally)

## Option 1: Railway Persistent Volume (Recommended)

### Step 1: Create Volume in Railway

1. Open your Railway project
2. Go to your service (e.g., `live-identity-openclip`)
3. Click "Variables" tab
4. Click "New Volume"
5. Set mount path: `/data/trained-model`
6. Size: 1 GB (plenty of space for model + embeddings)

### Step 2: Upload Files to Volume

Railway volumes are attached to running services. Upload files via:

**Method A: Using Railway CLI**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Upload files (from your local machine)
railway run bash -c "
  mkdir -p /data/trained-model && \
  curl -L -o /data/trained-model/b1_best.pt https://your-s3-bucket.../b1_best.pt && \
  curl -L -o /data/trained-model/cat_full_b1.npy https://your-s3-bucket.../cat_full_b1.npy && \
  curl -L -o /data/trained-model/cat_art_b1.npy https://your-s3-bucket.../cat_art_b1.npy && \
  curl -L -o /data/trained-model/cat_ids.json https://your-s3-bucket.../cat_ids.json
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

In Railway service environment variables:
```bash
TRAINED_MODEL_WEIGHTS=/data/trained-model/b1_best.pt
TRAINED_MODEL_CAT_FULL=/data/trained-model/cat_full_b1.npy
TRAINED_MODEL_CAT_ART=/data/trained-model/cat_art_b1.npy
TRAINED_MODEL_CAT_IDS=/data/trained-model/cat_ids.json

# Optional tuning
TRAINED_MODEL_ACCEPT=0.68
TRAINED_MODEL_MARGIN=0.02
TRAINED_MODEL_TOPK=5
```

### Step 4: Verify

After deployment, check `/health`:
```bash
curl https://your-railway-url/health
```

Should return:
```json
{
  "ok": true,
  "pipeline": "trained_dinov2",
  "model": "dinov2_s_subcenter_arcface",
  "indexed": 2000
}
```

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

If trained model files are not available or fail to load, the sidecar automatically falls back to OpenCLIP. Check `/health` to see which pipeline is active:

```json
{
  "pipeline": "openclip_hnsw"  // Fallback active
}
```

or

```json
{
  "pipeline": "trained_dinov2"  // Trained model active
}
```

## Troubleshooting

### "Model file not found"

Check:
1. Volume is mounted at `/data/trained-model`
2. Files exist: `ls -lh /data/trained-model/`
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

The trained model needs ~500-700 MB RAM. If OOM:
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
