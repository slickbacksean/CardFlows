/**
 * P1-16: a quick on-phone quality check before a Grade photo is uploaded.
 * Works on a small grayscale copy (about 256 px on the long side), so it runs
 * in plain JS in Expo Go. Thresholds are deliberately loose: the goal is to
 * catch clearly bad photos (≤ 2% false flags), and the server still makes
 * the final call. Retake reasons reuse PREGRADE_COPY.
 */
import { GRADE_FRAME_FILL, gradeGuideFrame } from "./grade-capture-guide";
import { PREGRADE_COPY } from "./pregrade-copy";

export const PHONE_CHECK_LONG_SIDE = 256;
/** Laplacian variance (0–255 gray) of the centre under which the photo is clearly soft. */
export const PHONE_CHECK_BLUR_MIN = 18;
/** Mean gradient in a frame-corner patch above which a card edge is present. */
export const PHONE_CHECK_CORNER_EDGE_MIN = 6;
/** Fewer corner patches with an edge than this means the card isn't lined up. */
export const PHONE_CHECK_MIN_CORNERS = 2;
/** Below this whole-photo mean gradient there is nothing in the photo at all. */
export const PHONE_CHECK_EMPTY_GRADIENT_MAX = 1.5;

export const PHONE_CHECK_COPY = {
  checking: "Checking photo…",
  checkAnyway: "Check anyway",
  phoneFlagNote: "Spotted on your phone before upload.",
} as const;

export interface GrayImage {
  width: number;
  height: number;
  /** One byte per pixel, row-major. */
  data: Uint8Array;
}

export interface PhoneCheckResult {
  ok: boolean;
  reasons: string[];
  sharpness: number;
  cornersWithEdges: number;
}

/** RGBA (as decoded from JPEG) → gray. */
export function rgbaToGray(width: number, height: number, rgba: Uint8Array): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 1, p += 4) {
    data[i] = (rgba[p]! * 77 + rgba[p + 1]! * 150 + rgba[p + 2]! * 29) >> 8;
  }
  return { width, height, data };
}

function laplacianVariance(img: GrayImage, x0: number, y0: number, x1: number, y1: number): number {
  const { width, data } = img;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = Math.max(1, y0); y < Math.min(img.height - 1, y1); y += 1) {
    for (let x = Math.max(1, x0); x < Math.min(width - 1, x1); x += 1) {
      const i = y * width + x;
      const v = 4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - width]! - data[i + width]!;
      sum += v;
      sumSq += v * v;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function meanGradient(img: GrayImage, x0: number, y0: number, x1: number, y1: number): number {
  const { width, data } = img;
  let total = 0;
  let n = 0;
  for (let y = Math.max(1, y0); y < Math.min(img.height - 1, y1); y += 1) {
    for (let x = Math.max(1, x0); x < Math.min(width - 1, x1); x += 1) {
      const i = y * width + x;
      total += Math.abs(data[i + 1]! - data[i - 1]!) + Math.abs(data[i + width]! - data[i - width]!);
      n += 1;
    }
  }
  return n === 0 ? 0 : total / (2 * n);
}

/**
 * Check one still. `frameFill` is the guide's card long side as a share of
 * the photo height (the zoomed Grade camera uses 0.55).
 */
export function phonePhotoCheck(img: GrayImage, frameFill: number = GRADE_FRAME_FILL.zoomed): PhoneCheckResult {
  const { width: w, height: h } = img;
  const sharpness = laplacianVariance(img, Math.round(w * 0.2), Math.round(h * 0.2), Math.round(w * 0.8), Math.round(h * 0.8));
  const frame = gradeGuideFrame(w, h, frameFill, w > h ? "landscape" : "portrait");
  const left = Math.round((w - frame.width) / 2);
  const top = Math.round((h - frame.height) / 2);
  const patch = Math.max(4, Math.round(Math.min(frame.width, frame.height) * 0.18));
  const corners = [
    [left, top],
    [left + frame.width, top],
    [left, top + frame.height],
    [left + frame.width, top + frame.height],
  ];
  let cornersWithEdges = 0;
  for (const [cx, cy] of corners) {
    const g = meanGradient(img, cx! - patch, cy! - patch, cx! + patch, cy! + patch);
    if (g >= PHONE_CHECK_CORNER_EDGE_MIN) cornersWithEdges += 1;
  }
  const reasons: string[] = [];
  const overall = meanGradient(img, 0, 0, w, h);
  if (overall < PHONE_CHECK_EMPTY_GRADIENT_MAX) {
    reasons.push(PREGRADE_COPY.notFound);
  } else if (sharpness < PHONE_CHECK_BLUR_MIN) {
    // A soft photo also smears the corners, so blur is the one reason to show.
    reasons.push(PREGRADE_COPY.blurry);
  } else if (cornersWithEdges < PHONE_CHECK_MIN_CORNERS) {
    reasons.push(PREGRADE_COPY.shapeOff);
  }
  return { ok: reasons.length === 0, reasons, sharpness: Math.round(sharpness * 10) / 10, cornersWithEdges };
}

/**
 * Auto-capture corner probe: how many of the 4 frame corners show a card
 * edge in a small preview still (same check as above). An empty or clearly
 * soft still counts as 0, so a blurry preview never starts a hold.
 */
export function gradeProbeCorners(img: GrayImage, frameFill: number = GRADE_FRAME_FILL.zoomed): number {
  const result = phonePhotoCheck(img, frameFill);
  return result.ok || result.reasons[0] === PREGRADE_COPY.shapeOff ? result.cornersWithEdges : 0;
}
