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

YOLO26n emits the shared `CardQuad` (`packages/shared/src/card-quad.ts`) with **`source: "yolo26n-ab"`** so it can be scored next to the other card-finder detectors. Spec: `services/card-finder/INTERFACE.md`. Score with:

```sh
CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true CARD_FLOW_YOLO26N_ONDEVICE=true \
  python3 services/card-finder/eval.py MANIFEST --detector yolo26n
```

PR #34 (`cursor/card-finder-model`) is not merged yet. This branch **copied** `card-quad.ts` / `card-quad.test.ts`, `INTERFACE.md`, and `score.py` verbatim from that branch and added a `yolo26n` runner to `eval.py`. Reconcile by keeping `card-quad.ts` identical and merging only the `yolo26n` bits in `eval.py`.

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

## Benchmarks (measured 2026-10-11)

Hardware: Linux x86_64, Intel Xeon (4 cores), **CPU only**, Python 3.12.3, Ultralytics **8.4.175**, torch **2.14.1+cpu**. Not a phone. Not an emulator.

| Artifact | Size | Notes |
|----------|------|--------|
| `yolo26n.pt` (COCO detect, official) | **5,544,453 bytes** (5.29 MiB) | Gitignored |
| `yolo26n-card.tflite` (LiteRT FP32, imgsz=640) | **9,970,397 bytes** (9.51 MiB) | Export succeeded |
| `yolo26n-card.mlpackage` (CoreML) | **Not produced** | `coremltools` 9.0 on this Linux VM failed: `only 0-dimensional arrays can be converted to Python scalars`. Re-export on macOS. |
| `yolo11n-obb.pt` | 5,795,654 bytes | Used only for the DOTA8 probe |
| `yolo26n-obb.pt` | 5,907,357 bytes | Used only for the DOTA8 probe |

| Latency | Mean | Protocol |
|---------|------|----------|
| `yolo26n.pt` detect | **22.62 ms** | imgsz=640, 2 warmup + 5 timed `predict` calls, one 640×480 synthetic rectangle probe (not a TCG photo) |
| `yolo26n.tflite` detect | **27.92 ms** | Same image / imgsz; TFLite XNNPACK CPU delegate |
| iOS CoreML / Android device | **Not measured** | No iPhone, Android device, or emulator in this run |
| Rectangle detector (Vision / Sobel) | **Not measured** | Native-only; no host port |

| Accuracy | Result |
|----------|--------|
| TCG livestream / phone frames | **Not measured.** No labeled stream or phone eval set in the repo. Pretrained `yolo26n` is COCO, not a card checkpoint. |
| Fine-tune on real frames | **Not run.** `finetune-yolo26n.py` refused a missing `--data` path (exit 1). No synthetic substitute was generated. |

### Rotated boxes (DOTA8 official sample — not TCG cards)

Ultralytics `dota8.yaml` val: **4 images, 8 instances**. Too small to confirm or deny the published YOLO26-OBB regression ([ultralytics#24205](https://github.com/ultralytics/ultralytics/issues/24205)).

| Model | mAP50 | mAP50-95 | Inference ms / image (tool log) |
|-------|-------|----------|----------------------------------|
| `yolo11n-obb.pt` | 0.995 | 0.857 | 32.1 |
| `yolo26n-obb.pt` | 0.995 | 0.859 | 26.3 |

On this 4-image official sample, YOLO26n-OBB did **not** score below YOLO11n-OBB. That is not a TCG rotated-card result and is not a substitute for a real holdout.
