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
    return { ...still, usedObbCrop: false };
  }
  try {
    const bitmap = await decodeScanStill(still.bytes, still.mimeType);
    if (!bitmap || bitmap.width < 2 || bitmap.height < 2) {
      return { ...still, usedObbCrop: false };
    }
    const box = bestObbBox(await detector.detect(bitmap));
    if (!box || isFullFrameBox(bitmap, box)) {
      return { ...still, usedObbCrop: false };
    }
    const cropped = downscaleForVision(cropOrientedBox(bitmap, box));
    if (cropped.width < 2 || cropped.height < 2) {
      return { ...still, usedObbCrop: false };
    }
    return {
      bytes: encodePngStill(cropped),
      mimeType: "image/png",
      usedObbCrop: true,
    };
  } catch {
    return { ...still, usedObbCrop: false };
  }
}
