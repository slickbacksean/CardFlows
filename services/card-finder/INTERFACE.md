# Shared crop / corners interface

All card detectors target one contract so we build one pipeline, not two.

- TypeScript types: `packages/shared/src/card-quad.ts` (`CardQuad`, `CardCorners`,
  `CARD_CANONICAL_WIDTH_PX` / `_HEIGHT_PX`, `scaleCardCorners`, `isCardQuad`)
- Python (server): `services/card-finder/finder.py` returns `FoundCard(corners, confidence, confident)`
  with the same conventions; `apps/api/vendor/cardgrading/pipeline/detect.py` takes
  external corners through `detect_and_normalize(image, thresholds, corners=...)`.

## Conventions

1. **Corners**: 4 points `[x, y]` in source-image pixels, origin top-left, after EXIF
   rotation. Order TL, TR, BR, BL of the card as it reads upright.
2. **Virtual corners**: the intersection of the two straight edges, outside the rounded
   corner. Test-set labels use the same convention, so corner error is comparable.
3. **Crop**: consumers never take a detector's own crop. They warp the full-res still
   with `cv2.getPerspectiveTransform(corners -> 1500x2100)`, which is 63 x 88 mm at
   about 605 dpi. Grading measures on that warp. The identity matcher (OpenCLIP today)
   gets the same warp resized to its input size.
4. **Confidence / accepted**: `accepted=false` means retake or picker, never a guess.
   Each detector calibrates its own accept threshold against the wrong-crop bar
   (1% or less) on the frozen test set.
5. **Preview to still**: on-device detectors run on preview frames; scale with
   `scaleCardCorners` and let the server re-detect on the full-res still. The server's
   corners win.

## For the YOLO26n A/B baseline (test-only, AGPL flag)

Emit `CardQuad` with `source: "yolo26n-ab"`. Convert the OBB to 4 corners in TL, TR, BR,
BL order of the upright card. Score it with
`python3 services/card-finder/eval.py MANIFEST --detector <name>` by adding a runner in
`eval.py` that returns `(corners, accepted)`. Keep it out of production and App Store
builds.
