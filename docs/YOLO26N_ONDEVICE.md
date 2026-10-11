# On-device YOLO26n card detect (pre-ship only)

**Status:** development / device QA only. Not for production or App Store.

**TODO(ship):** Replace YOLO26n (Ultralytics AGPL-3.0) with a non-AGPL detector, or buy an [Ultralytics Enterprise](https://www.ultralytics.com/license) license, before any store ship. Weights stay gitignored either way.

## What this is

Livestream still copies in-app live-page video (never a page screenshot, never Capture, never the phone camera as the product). Crops still go to the existing OpenCLIP sidecar / pHash identity path.

The new piece is an optional **on-device card detector**:

| Platform | Model | Runtime |
|----------|--------|---------|
| iOS | `yolo26n-card.mlpackage` | CoreML + `VNCoreMLRequest` |
| Android | `yolo26n-card.tflite` | LiteRT / TFLite via reflection |

`VNDetectRectanglesRequest` (iOS) and the Sobel rectangle detector (Android) stay as the **fallback** when the gate is closed, the model file is missing, or YOLO misses the card.

An **A/B mode** (`CARD_FLOW_YOLO26N_MODE=ab`) runs both detectors on the same frame, compares IoU / agreement / latency, and still crops from YOLO when it hits, else rectangle.

`yolo_identity` on Settings / `/health` remains the pipeline **name**. It is not a shipped Ultralytics identity head.

## License gate

All of this stays behind the existing AGPL flag plus an explicit opt-in:

```sh
CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true
CARD_FLOW_YOLO26N_ONDEVICE=true
CARD_FLOW_YOLO26N_MODE=ab          # or yolo26n
```

On the phone, use the `EXPO_PUBLIC_` mirrors of those names in a **development client** only.

Hard offs:

- `eas.json` `production` (store) and `preview` set the opt-in env to `false`
- `yolo26nOnDeviceAllowed()` returns false for EAS profiles `production`, `store`, `app-store`, `appstore` even if the opt-in is true
- Android `build.gradle` writes `BuildConfig.YOLO26N_ONDEVICE=false` on those profiles
- `apps/mobile/app.json` extras default `yolo26nOnDevice` / `ultralyticsAgplAccepted` to `false`

Do not add `.pt` / `.tflite` / `.mlpackage` to git (`apps/mobile/models/` is gitignored).

## Export (gitignored weights)

```sh
cd apps/mobile/modules/cardflow-live-video
python3 -m venv .yolo26n-export/venv
.yolo26n-export/venv/bin/pip install -U ultralytics coremltools onnx
CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true \
  .yolo26n-export/venv/bin/python scripts/export-yolo26n-ondevice.py \
  --out ../../../models --benchmark --obb-compare
```

Copy the exported files onto the device (Documents/`models` on iOS, `/data/local/tmp/cardflow/` on Android) or pass `modelPath` through `setDetectorConfig`. Production / store EAS builds must not package them.

## Data spec (real frames only)

The only crop model trained in-tree so far used **72 synthetic images** (`apps/api/scripts/export-yolo11n-obb.py`). Do not reuse that generator for YOLO26n.

Fine-tune only on **real** frames:

| Field | Rule |
|-------|------|
| Source | Livestream in-app sample buffers and/or phone stills of **physical** English TCG cards. Table, hand, scanner, Whatnot/eBay show. |
| Not allowed | TCG Pocket sprites, catalog art as “in-stream”, screenshots of the live page, the 72-image synthesizer, any generated `SYNTHETIC` tree |
| Layout | Ultralytics detect YAML, one class `card` (`nc: 1`) |
| Splits | `train/images` + `train/labels`, `val/images` + `val/labels`. Optional `test/` for holdout. |
| Labels | YOLO detect `class x y w h` (normalized). One row per visible card. |
| Rotation | Include cards rotated ≥20°. For OBB experiments use `xyxyxyxy` labels in a separate `*-obb` yaml — do not mix detect and OBB labels. |
| Size | Prefer ≥200 real train frames and ≥40 val frames before claiming accuracy. Fewer is fine for a smoke fine-tune; say so. |
| Provenance | Keep a sidecar `SOURCE.txt` per split listing show/device/date. No vendor art dumps. |

Example `data.yaml`:

```yaml
path: /abs/path/to/cardflow-yolo26n-real
train: train/images
val: val/images
nc: 1
names: [card]
```

`scripts/finetune-yolo26n.py --data /abs/path/to/data.yaml` **refuses** missing folders, empty splits, unlabeled images, `.obb-train`, and a `SYNTHETIC` marker. It does not create frames.

## Rotated cards

YOLO26n **detect** exports axis-aligned boxes. Livestream cards are often rotated.

Upstream: [ultralytics#24205](https://github.com/ultralytics/ultralytics/issues/24205) reported YOLO26-OBB mAP below YOLO11 / 8.3.x, later tied to an in-place OBB assigner bug ([PR #24260](https://github.com/ultralytics/ultralytics/pull/24260)). Re-check on the Ultralytics version you install.

This repo does **not** invent TCG OBB scores. If you have a labeled real holdout, score AABB IoU against the card’s axis-aligned envelope **and** a rotated-only slice (GT angle ≥20°). Optional: `export-yolo26n-ondevice.py --obb-compare` runs YOLO11n-OBB vs YOLO26n-OBB on official `dota8.yaml` (rotated objects, **not** cards).

## A/B harness

Shared helper: `compareLiveVideoDetectors` / `summarizeLiveVideoDetectorAb` in `packages/shared/src/live-video-detector.ts`.

Native `pullSampleBuffer` may include `detector`, `detectLatencyMs`, and `detectorAb`. Crops still post to `/v1/livestream/identify` as `identityCropJpeg` / `identityRgb`.
