import {
  bestObbBox,
  cropOrientedBox,
  isGradeImageMime,
  resizeRgb,
  type GradeImageMimeType,
  type ObbBox,
  type ObbDetector,
  type RgbBitmap,
} from "@cardflow/shared";
import { decodeScanStill, encodePngStill } from "./obb-phash-decode";
import { createObbDetectorFromEnv } from "./obb-onnx";

/** Anthropic vision input is happiest under ~1568px on the long edge. */
export const GRADE_VISION_MAX_EDGE = 1568;

/**
 * P0-04 aspect-gate choice (must match calibration/thresholds.json).
 *
 * A 90° sideways 63:88 card is ~95% off the expected ratio, so the 8% gate
 * never saved those photos — rotating to portrait before the aspect check
 * does. After that correction:
 * - 3% is the default gate (`aspect_ratio_tolerance_pct`).
 * - 8% applies only when tilt already passed (`aspect_ratio_tolerance_upright_pct`),
 *   because square-corner phone captures of real cards sit in the 3–8% range
 *   from perspective, while card+background misdetections sit at 15–28%.
 *
 * Chosen: keep this 3%/8% split. Do not collapse to 3% for tilt-ok photos
 * until the P0-20 frozen set shows false retakes stay at or below 2%.
 */
export const GRADE_ASPECT_TOLERANCE_PCT = 3;
export const GRADE_ASPECT_TOLERANCE_PERSPECTIVE_PCT = 8;

export interface GradeStillBytes {
  bytes: Uint8Array;
  mimeType: GradeImageMimeType;
}

export interface PreprocessedGradeStill extends GradeStillBytes {
  /**
   * True when Capture YOLO OBB produced a tighter, straightened crop.
   * False is the documented stub: send the original still unchanged.
   */
  usedObbCrop: boolean;
  /** True when a landscape still was rotated 90° clockwise to portrait. */
  rotated90: boolean;
}

function isFullFrameBox(image: RgbBitmap, box: ObbBox): boolean {
  if (Math.abs(box.angle) > 1e-3) return false;
  if (Math.round(Math.abs(box.width)) < image.width - 1) return false;
  if (Math.round(Math.abs(box.height)) < image.height - 1) return false;
  return (
    Math.abs(box.cx - image.width / 2) < 1.5 && Math.abs(box.cy - image.height / 2) < 1.5
  );
}

function downscaleForVision(bitmap: RgbBitmap): RgbBitmap {
  const longEdge = Math.max(bitmap.width, bitmap.height);
  if (longEdge <= GRADE_VISION_MAX_EDGE) return bitmap;
  const scale = GRADE_VISION_MAX_EDGE / longEdge;
  return resizeRgb(
    bitmap,
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
}

/** 90° clockwise so a landscape still is portrait before aspect / OBB. */
export function rotateRgb90Clockwise(image: RgbBitmap): RgbBitmap {
  const width = image.height;
  const height = image.width;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const destX = image.height - 1 - y;
      const destY = x;
      const src = (y * image.width + x) * 3;
      const dst = (destY * width + destX) * 3;
      data[dst] = image.data[src] ?? 0;
      data[dst + 1] = image.data[src + 1] ?? 0;
      data[dst + 2] = image.data[src + 2] ?? 0;
    }
  }
  return { width, height, data };
}

export function ensurePortraitRgb(image: RgbBitmap): { bitmap: RgbBitmap; rotated90: boolean } {
  if (image.width <= image.height) return { bitmap: image, rotated90: false };
  return { bitmap: rotateRgb90Clockwise(image), rotated90: true };
}

/**
 * A real OBB crop only. A missing detector, failed decode, or full-frame stub
 * is not a card. Callers must not score that still.
 */
export async function locateGradeCard(
  still: GradeStillBytes,
  detector: ObbDetector = createObbDetectorFromEnv(),
): Promise<PreprocessedGradeStill | null> {
  const processed = await preprocessGradeStill(still, detector);
  return processed.usedObbCrop ? processed : null;
}

/**
 * Locate / straighten / crop with the same Capture YOLO11 Nano OBB detector
 * when it returns a real box. Missing weights, failed decode, or no card →
 * send the full still (documented stub). Never catalog art. Not casecomp source.
 */
export async function preprocessGradeStill(
  still: GradeStillBytes,
  detector: ObbDetector = createObbDetectorFromEnv(),
): Promise<PreprocessedGradeStill> {
  if (!isGradeImageMime(still.mimeType) || still.bytes.byteLength === 0) {
    return { ...still, usedObbCrop: false, rotated90: false };
  }
  try {
    const decoded = await decodeScanStill(still.bytes, still.mimeType);
    if (!decoded || decoded.width < 2 || decoded.height < 2) {
      return { ...still, usedObbCrop: false, rotated90: false };
    }
    const { bitmap, rotated90 } = ensurePortraitRgb(decoded);
    const unchanged = (): PreprocessedGradeStill =>
      rotated90
        ? { bytes: encodePngStill(bitmap), mimeType: "image/png", usedObbCrop: false, rotated90 }
        : { ...still, usedObbCrop: false, rotated90: false };
    const box = bestObbBox(await detector.detect(bitmap));
    if (!box || isFullFrameBox(bitmap, box)) return unchanged();
    const cropped = downscaleForVision(cropOrientedBox(bitmap, box));
    if (cropped.width < 2 || cropped.height < 2) return unchanged();
    return {
      bytes: encodePngStill(cropped),
      mimeType: "image/png",
      usedObbCrop: true,
      rotated90,
    };
  } catch {
    return { ...still, usedObbCrop: false, rotated90: false };
  }
}
