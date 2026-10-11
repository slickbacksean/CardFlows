import { GRADE_IMAGE_MAX_BYTES } from "./grade-estimate";

export interface PickedGradeStill {
  uri: string;
  mimeType: string | null;
}

/** Grading needs enough pixels across the card's short side. */
export const GRADE_STILL_MIN_SHORT_SIDE_PX = 1200;
export const GRADE_STILL_TOO_SMALL_COPY =
  "That photo is too small to grade. Retake it closer, in good light." as const;

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
  return {
    still: {
      uri: input.uri,
      mimeType: input.format === "png" ? "image/png" : "image/jpeg",
    },
  };
}

