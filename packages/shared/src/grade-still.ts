import { GRADE_IMAGE_MAX_BYTES } from "./grade-estimate";

export interface PickedGradeStill {
  uri: string;
  mimeType: string | null;
  width?: number;
  height?: number;
}

/** Grading needs enough pixels across the card's short side. */
export const GRADE_STILL_MIN_SHORT_SIDE_PX = 1200;
export const GRADE_STILL_TOO_SMALL_COPY =
  "That photo is too small to grade. Retake it closer, in good light." as const;

/**
 * Long-edge cap for uploaded grade/scan stills (P0-02).
 *
 * Range considered: 3000–4032 px. Picked **4032** (native 12 MP iPhone,
 * 4032×3024). The frozen 300-photo set (P0-20) is not in CI yet, so this is
 * the conservative end: typical iPhone stills are not downscaled further, so
 * reference-set estimates should not move. 48 MP phones still drop to 12 MP
 * (25% of the pixels) and JPEG quality 0.8 vs the old quality-1 original,
 * which is well over a 60% byte cut per grade.
 */
export const GRADE_STILL_MAX_LONG_EDGE_PX = 4032;
export const GRADE_STILL_TOO_LARGE_COPY =
  "That photo is too large. Long edge must be 4032 pixels or smaller." as const;
export const GRADE_UPLOAD_EXPIRED_COPY =
  "Photo upload expired. Take the photos again." as const;

export function scaleToLongEdge(
  width: number,
  height: number,
  maxLongEdge: number = GRADE_STILL_MAX_LONG_EDGE_PX,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width, height };
  }
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Resize action for expo-image-manipulator, or null when the still already fits. */
export function gradeStillResizeAction(
  width: number,
  height: number,
  maxLongEdge: number = GRADE_STILL_MAX_LONG_EDGE_PX,
): { resize: { width: number; height: number } } | null {
  const next = scaleToLongEdge(width, height, maxLongEdge);
  if (next.width === width && next.height === height) return null;
  return { resize: next };
}

/** Pixel remaining-ratio after the long-edge cap. Used to document the upload-byte cut. */
export function gradeStillPixelRatio(
  width: number,
  height: number,
  maxLongEdge: number = GRADE_STILL_MAX_LONG_EDGE_PX,
): number {
  const from = width * height;
  if (!(from > 0)) return 1;
  const next = scaleToLongEdge(width, height, maxLongEdge);
  return (next.width * next.height) / from;
}

/**
 * Pick the largest size from CameraView.getAvailablePictureSizesAsync().
 * Android returns "WxH" strings; iOS returns presets, where "Photo" is full resolution.
 */
export function largestPictureSize(sizes: readonly string[]): string | undefined {
  let best: { size: string; area: number } | undefined;
  for (const size of sizes) {
    const match = /^(\d+)x(\d+)$/i.exec(size.trim());
    if (!match) continue;
    const area = Number(match[1]) * Number(match[2]);
    if (!best || area > best.area) best = { size, area };
  }
  if (best) return best.size;
  if (sizes.includes("Photo")) return "Photo";
  return undefined;
}

export function stillFromCameraCapture(input: {
  uri: string | null | undefined;
  format?: "jpg" | "png";
  fileSize?: number;
  width?: number;
  height?: number;
}): { still: PickedGradeStill } | { error: string } {
  if (!input.uri) return { error: "Could not take a photo. Try again." };
  if (
    typeof input.width === "number" &&
    typeof input.height === "number" &&
    input.width > 0 &&
    input.height > 0 &&
    Math.min(input.width, input.height) < GRADE_STILL_MIN_SHORT_SIDE_PX
  ) {
    return { error: GRADE_STILL_TOO_SMALL_COPY };
  }
  if (typeof input.fileSize === "number" && input.fileSize > GRADE_IMAGE_MAX_BYTES) {
    return { error: "Image must be 20 MB or smaller" };
  }
  const still: PickedGradeStill = {
    uri: input.uri,
    mimeType: input.format === "png" ? "image/png" : "image/jpeg",
  };
  if (typeof input.width === "number" && typeof input.height === "number") {
    still.width = input.width;
    still.height = input.height;
  }
  return { still };
}

