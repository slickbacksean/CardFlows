# Trained Model Integration - Implementation Guide

## Current Status (PR #119)

### ✅ Completed
1. **Multi-frame temporal voting** - Averages similarities + adds best frame score
2. **OCR text pooling** - Pools names/numbers across all frames in hold  
3. **OCR reranking** - Boosts candidates matching pooled OCR (+0.15)
4. **RapidOCR for Linux** - Cross-platform OCR via onnxruntime (Apache-2.0)
5. **Apple Vision OCR** - macOS-only OCR fallback
6. **OpenCLIP matcher** - Primary recognizer (works well, proven in production)

### 📝 Next Phase: Trained Model Integration

The trained DINOv2-S + SubCenterArcFace model needs integration to replace/augment OpenCLIP. This requires:

## Model Architecture

- **Backbone**: DINOv2-S (vit_small_patch14_dinov2.lvd142m) from timm
- **Training**: Last 8 blocks + norm layer unfrozen
- **Head**: Residual linear (384->384, zero-init): `output = x + A(x)`, L2 normalize
- **Training loss**: SubCenterArcFace (K=3, s=30, m=0.50) + contrastive
- **Weights**: `b1_best.pt` (~148 MB PyTorch checkpoint)
- **Catalog**: Precomputed embeddings for full-card + art-crop views

## Implementation Options

### Option 1: ONNX Export (Recommended)
**Pros**: Fast CPU inference, portable, no PyTorch dependency  
**Cons**: Need to export model to ONNX format first  
**Latency**: ~100-200ms per frame on Railway-sized CPU

**Steps**:
1. Export PyTorch model to ONNX:
   ```python
   import torch, timm
   m = timm.create_model('vit_small_patch14_dinov2.lvd142m', pretrained=True, num_classes=0)
   # Load weights, add head
   torch.onnx.export(full_model, dummy_input, "b1_dinov2.onnx")
   ```
2. Load ONNX in Node.js via `onnxruntime-node`
3. Implement preprocessing (224x224 crop, normalize)
4. Compute similarities against catalog embeddings

### Option 2: PyTorch via Python Child Process
**Pros**: No model conversion needed  
**Cons**: Slower, Python dependency, IPC overhead  
**Latency**: ~300-500ms per frame

**Steps**:
1. Create Python inference script
2. Spawn child process, communicate via JSON
3. Keep warm between requests

### Option 3: TorchScript
**Pros**: JIT-optimized, no Python runtime  
**Cons**: Need libtorch C++ library, complex build  
**Latency**: Similar to ONNX

## Catalog Files

Precomputed embeddings for matching:

- **cat_full_b1.npy**: Full-card embeddings (float16, shape: [N, 384])
- **cat_art_b1.npy**: Art-crop embeddings (float16, shape: [N, 384])
- **cat_ids.json**: TCGdex IDs for each row
- **Total size**: ~50-100 MB depending on catalog size

### NumPy .npy Format
```
Header (128 bytes):
  Magic: \x93NUMPY
  Version: uint8, uint8
  Header length: uint16/uint32 (little-endian)
  Header dict: Python literal with dtype, shape, order
Data: Raw array data (float16 or float32)
```

## Inference Flow

```typescript
// Preprocessing
const prep = (image: Buffer) => {
  // 1. Decode image (sharp, opencv, etc.)
  // 2. Resize: short side -> 224, bicubic
  // 3. Center crop 224x224
  // 4. Convert BGR -> RGB, normalize with ImageNet mean/std
  // 5. Return [1, 3, 224, 224] tensor
};

// Inference
const embed = async (crop: Buffer): Promise<Float32Array> => {
  const input = prep(crop);
  const output = await onnxSession.run({ input });
  // Apply residual head: x + A(x), then L2 normalize
  return normalize(output.add(headLinear(output)));
};

// Matching
const match = (query: Float32Array): TopK => {
  // Score = (query @ cat_full + query @ cat_art) / 2
  const scoreFull = matmul(query, catFull);
  const scoreArt = matmul(query, catArt);
  const score = (scoreFull + scoreArt) / 2;
  
  // Name-pooled: max score per name
  const nameScores = new Map();
  for (let i = 0; i < score.length; i++) {
    const name = cardNames[catIds[i]];
    nameScores.set(name, Math.max(nameScores.get(name) || 0, score[i]));
  }
  
  return topK(nameScores, 5);
};
```

## Environment Variables

```bash
# Trained model (when available)
CARD_FLOW_TRAINED_MODEL_WEIGHTS=https://s3.../b1_best.pt
CARD_FLOW_TRAINED_MODEL_CAT_FULL=https://s3.../cat_full_b1.npy
CARD_FLOW_TRAINED_MODEL_CAT_ART=https://s3.../cat_art_b1.npy
CARD_FLOW_TRAINED_MODEL_CAT_IDS=https://s3.../cat_ids.json
CARD_FLOW_TRAINED_MODEL_THRESHOLD=0.68  # Accept threshold
CARD_FLOW_TRAINED_MODEL_TOPK=5  # Top-K candidates

# RapidOCR (current)
CARD_FLOW_RAPIDOCR_ENABLED=1  # Enable on Linux

# OpenCLIP (current fallback)
CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL=http://sidecar:8080
```

## Integration Strategy

1. **Phase 1** (Current PR): RapidOCR + OpenCLIP + temporal voting ✅
2. **Phase 2** (Next): Export model to ONNX, load in Node.js
3. **Phase 3**: Replace OpenCLIP with trained model when available
4. **Phase 4**: Measure latency, optimize (int8 quantization if needed)

## Latency Budget

Target: <300ms per frame on Railway Starter plan (512 MB RAM, shared CPU)

- Image decode: ~20-40ms
- Preprocessing: ~10-20ms
- DINOv2-S inference: ~100-200ms (ONNX CPU)
- Similarity search: ~5-10ms
- RapidOCR (parallel): ~100-200ms
- **Total**: ~235-470ms

If >300ms, options:
- ONNX int8 quantization (~2x speedup)
- Reduce catalog size (filter by popularity)
- Upgrade Railway plan (more CPU)
- Skip OCR on some frames

## Deployment on Railway

### Dockerfile/Nixpacks
Already configured for Node.js + onnxruntime-node. No changes needed for ONNX-based model.

### Memory Requirements
- Base app: ~150 MB
- ONNX runtime: ~50 MB
- DINOv2-S model: ~150 MB
- Catalog embeddings: ~100 MB
- Working memory: ~50 MB
- **Total**: ~500 MB

Railway Starter (512 MB) should be sufficient. May need Pro (2 GB) for headroom.

### Model Loading
Models download on first request (cached in .cache/). Startup time: +5-10 seconds.

## Testing

Add tests for:
- `.npy` file parsing
- Image preprocessing (224x224 crop, normalization)
- Embedding extraction
- Similarity computation
- Name-pooled ranking
- Integration with existing OCR reranking

## Fallback Strategy

1. Try trained model (if configured)
2. Fall back to OpenCLIP (if sidecar available)
3. Fall back to pHash (last resort)
4. CardSight for low confidence (hybrid rule unchanged)

## References

- Training script: `train_b1_32d7.py`
- Eval script: `eval_b1_5a34.py`
- OCR rerank: `ocr_rerank_eval_2338.py`
- Catalog IDs: `cat_ids_b8cb.json`
