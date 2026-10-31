# Robust Server-Side Card Crop Localization (r16)

## Overview

The robust localization feature addresses accuracy issues when clients send only a loose bounding box (Android, and iOS when no quad is available). The original crop often includes surrounding objects (e.g. cups, stands on eBay Live), squashing the card into a smaller portion of the crop.

## Problem

Offline evaluation on the eBay test set showed:
- **Without localization (v1)**: 41.7% accuracy
- **With localization (r16)**: 75% accuracy
- No regressions on other test sets

## Solution

The r16 crop pipeline adds robust server-side localization:

1. **Card Localization**: Inside the rough bounding box, find the card's actual quadrilateral edges using:
   - Canny edge detection + contour finding for tilted cards
   - Axis-aligned rectangle search for upright cards (gradient-based edge detection)
   - Sub-pixel edge refinement via RANSAC line fitting

2. **Hybrid Choice**: Score both the original crop and the new localized crop, keeping whichever has higher catalog-match confidence (label-free).

3. **Multi-Frame Logic** (future): Embed each localized frame, split the hold where the card changes (similarity drop or position jump), choose one contiguous run of 2+ frames, drop outliers, and use the medoid frame.

## Environment Variables

### Feature Flag

- **`LIVE_IDENTITY_LOCALIZE`**: Enable robust localization (default: `0` = OFF)
  - Set to `1` to enable
  - When enabled, the server will attempt to localize cards inside loose bounding boxes
  - Falls back gracefully if localization fails

### Model Selection

- **`TRAINED_MODEL_VERSION`**: Model version to use (default: `r10`)
  - `r10`: Original trained model
  - `r16`: New model with robust crop training data
  
### Model Paths (for r16)

When using r16, ensure these environment variables point to the r16 weights:

- **`TRAINED_MODEL_WEIGHTS`**: Path to r16 checkpoint (e.g., `/mnt/railway-volume/r16/b1_best.pt`)
- **`TRAINED_MODEL_CAT_FULL`**: Path to r16 full catalog embeddings
- **`TRAINED_MODEL_CAT_ART`**: Path to r16 art crop catalog embeddings
- **`TRAINED_MODEL_CAT_IDS`**: Path to r16 catalog IDs

## Usage

### Development (Testing)

```bash
# Enable localization with r10 model (for testing the localization pipeline)
export LIVE_IDENTITY_LOCALIZE=1
export TRAINED_MODEL_VERSION=r10
python serve.py
```

### Production (r16 model)

```bash
# Enable localization with r16 model
export LIVE_IDENTITY_LOCALIZE=1
export TRAINED_MODEL_VERSION=r16
export TRAINED_MODEL_WEIGHTS=/mnt/railway-volume/r16/b1_best.pt
export TRAINED_MODEL_CAT_FULL=/mnt/railway-volume/r16/cat_full_b1.npy
export TRAINED_MODEL_CAT_ART=/mnt/railway-volume/r16/cat_art_b1.npy
export TRAINED_MODEL_CAT_IDS=/mnt/railway-volume/r16/cat_ids.json
python serve.py
```

### Railway Deployment

Set these environment variables in Railway:

```
LIVE_IDENTITY_LOCALIZE=0  # Keep OFF initially for gradual rollout
TRAINED_MODEL_VERSION=r10  # Default to r10 until r16 is validated
```

After r16 weights are uploaded to the Railway volume:

```
LIVE_IDENTITY_LOCALIZE=1
TRAINED_MODEL_VERSION=r16
TRAINED_MODEL_WEIGHTS=/mnt/railway-volume/r16/b1_best.pt
TRAINED_MODEL_CAT_FULL=/mnt/railway-volume/r16/cat_full_b1.npy
TRAINED_MODEL_CAT_ART=/mnt/railway-volume/r16/cat_art_b1.npy
TRAINED_MODEL_CAT_IDS=/mnt/railway-volume/r16/cat_ids.json
```

## API Response Changes

When localization is enabled, the `/v1/match` endpoint returns additional fields:

```json
{
  "localized": true,  // true if localization was used
  "localizeMethod": "quad",  // "quad" | "rect" | "fallback" | null
  "warped": true  // true if any crop transformation was applied
}
```

Health endpoint also reports the localization status:

```json
{
  "localize": true,  // current LIVE_IDENTITY_LOCALIZE setting
  "modelVersion": "r16"  // current TRAINED_MODEL_VERSION
}
```

## Testing

Run unit tests:

```bash
python scripts/test_localize.py
```

Tests cover:
- Basic tilted card localization
- Upright card detection
- Localization inside loose bounding boxes
- Graceful failure when no card is present
- Landscape-oriented cards

## Client Behavior

### Android
- Sends only bounding boxes (no quad)
- **Benefits from localization**: The server will find the card edges inside the box

### iOS
- Sends quad when available
- Falls back to box when quad detection fails
- **Benefits from localization**: When quad is unavailable, server localizes inside the box

### Note
Client quad data (when available and valid) is still preferred. Localization is only used as a fallback when:
- No quad is provided, OR
- The provided quad is rejected by `warp_card` validation

## Performance

Localization adds minimal latency (~10-30ms) and only runs when needed (no quad or invalid quad).

## Rollout Plan

1. **Phase 1**: Deploy with `LIVE_IDENTITY_LOCALIZE=0` (feature OFF)
2. **Phase 2**: Upload r16 weights to Railway volume
3. **Phase 3**: Enable localization on staging: `LIVE_IDENTITY_LOCALIZE=1`
4. **Phase 4**: Monitor accuracy metrics on staging
5. **Phase 5**: Enable on production if metrics improve
6. **Phase 6**: Gradually roll out to all instances

## Monitoring

Key metrics to watch:
- `localized` field in match responses (% of requests using localization)
- `localizeMethod` distribution (quad vs rect vs fail)
- Overall match accuracy (catalog acceptance rate)
- Match latency (P50, P95)

## Algorithm Details

### Quad Detection
1. Canny edge detection on ROI
2. Find contours and approximate to quadrilaterals
3. Filter by aspect ratio (63:88 ± tolerance)
4. Score by contour fill ratio and aspect match
5. Refine edges to sub-pixel accuracy via RANSAC

### Rectangle Search (Upright Cards)
1. Compute gradient magnitude (Sobel)
2. Find candidate vertical/horizontal edges from gradient profiles
3. Score all valid rectangles (aspect ratio ~63:88)
4. Score = fraction of each side with strong perpendicular edge
5. All four sides must have support

### Hybrid Choice (Future Enhancement)
1. Score both original crop and localized crop
2. Embed both crops
3. Compare catalog-match confidence
4. Keep whichever has higher confidence
5. No labels used (label-free validation)

## Dependencies

The localization module uses only OpenCV and NumPy (no AGPL code):
- `opencv-python-headless>=4.9.0`
- `numpy>=1.26.0`

## References

- Original Python prototypes: `loc.py`, `rs.py`, `seg3.py`, `cropq.py`
- Offline evaluation results in `cropq.py` output
