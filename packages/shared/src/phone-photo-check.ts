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

/** Auto-capture: brightness step across a frame edge that counts as the card's edge (0-255 gray). */
export const GRADE_PROBE_EDGE_STEP_MIN = 14;
/** How far (share of the frame's short side) the card edge may sit from the drawn frame line. */
export const GRADE_PROBE_EDGE_SLACK = 0.08;
/** Each edge is checked in this many segments along it; all must step the same way. */
export const GRADE_PROBE_EDGE_SEGMENTS = 3;

function regionMean(img: GrayImage, x0: number, y0: number, x1: number, y1: number): number | null {
  const xa = Math.max(0, Math.min(x0, x1));
  const xb = Math.min(img.width, Math.max(x0, x1));
  const ya = Math.max(0, Math.min(y0, y1));
  const yb = Math.min(img.height, Math.max(y0, y1));
  if (xb - xa < 1 || yb - ya < 1) return null;
  let total = 0;
  for (let y = ya; y < yb; y += 1) {
    for (let x = xa; x < xb; x += 1) total += img.data[y * img.width + x]!;
  }
  return total / ((xb - xa) * (yb - ya));
}

/**
 * One frame edge near a corner: is there a straight brightness step along
 * the frame line (within the slack), the same sign in every segment? Random
 * texture (a patterned mat) has no consistent step, so it fails.
 */
function edgeAligned(
  img: GrayImage,
  axis: "h" | "v",
  line: number,
  from: number,
  to: number,
  slack: number,
  band: number,
): boolean {
  const seg = (to - from) / GRADE_PROBE_EDGE_SEGMENTS;
  for (let offset = -slack; offset <= slack; offset += 1) {
    const at = line + offset;
    let sign = 0;
    let ok = true;
    for (let k = 0; k < GRADE_PROBE_EDGE_SEGMENTS && ok; k += 1) {
      const a = Math.round(from + seg * k);
      const b = Math.round(from + seg * (k + 1));
      const before = axis === "h" ? regionMean(img, a, at - band, b, at) : regionMean(img, at - band, a, at, b);
      const after = axis === "h" ? regionMean(img, a, at, b, at + band) : regionMean(img, at, a, at + band, b);
      if (before == null || after == null) {
        ok = false;
        break;
      }
      const step = after - before;
      if (Math.abs(step) < GRADE_PROBE_EDGE_STEP_MIN || (sign !== 0 && Math.sign(step) !== sign)) ok = false;
      sign = Math.sign(step);
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Auto-capture corner probe (Mobile Tech Lead review 3): how many of the 4
 * frame corners have a card edge lined up with BOTH frame lines that meet
 * there. An empty or clearly soft still counts as 0, so a blurry preview never
 * starts a hold. Stricter than phonePhotoCheck's corner patches, which only
 * look for any texture.
 */
export function gradeProbeCorners(img: GrayImage, frameFill: number = GRADE_FRAME_FILL.zoomed): number {
  return gradeProbeDetail(img, frameFill).corners;
}

export interface GradeProbeDetail {
  /** Frame corners with a lined-up card edge (0-4); 0 when blurry or empty. */
  corners: number;
  /** Centre Laplacian variance of the probe (higher is sharper). */
  sharpness: number;
  /** Too soft to judge: the phone is likely closer than the camera can focus. */
  blurry: boolean;
}

/** gradeProbeCorners plus why: a blurry probe is not a miss, it means "move back". */
export function gradeProbeDetail(img: GrayImage, frameFill: number = GRADE_FRAME_FILL.zoomed): GradeProbeDetail {
  const basic = phonePhotoCheck(img, frameFill);
  const sharpness = basic.sharpness;
  if (basic.reasons[0] === PREGRADE_COPY.notFound) return { corners: 0, sharpness, blurry: false };
  if (basic.reasons[0] === PREGRADE_COPY.blurry) return { corners: 0, sharpness, blurry: true };
  return { corners: probeCornerCount(img, frameFill), sharpness, blurry: false };
}

function probeCornerCount(img: GrayImage, frameFill: number): number {
  const { width: w, height: h } = img;
  const frame = gradeGuideFrame(w, h, frameFill, w > h ? "landscape" : "portrait");
  if (!(frame.width > 8) || !(frame.height > 8)) return 0;
  const left = Math.round((w - frame.width) / 2);
  const top = Math.round((h - frame.height) / 2);
  const right = left + frame.width;
  const bottom = top + frame.height;
  const short = Math.min(frame.width, frame.height);
  const slack = Math.max(2, Math.round(short * GRADE_PROBE_EDGE_SLACK));
  const band = Math.max(2, Math.round(short * 0.04));
  // Check each edge over the 35% of its length nearest the corner, clear of the slack zone.
  const spanX = Math.round(frame.width * 0.35);
  const spanY = Math.round(frame.height * 0.35);
  const corners: Array<{ y: number; x: number; xs: [number, number]; ys: [number, number] }> = [
    { y: top, x: left, xs: [left + slack, left + slack + spanX], ys: [top + slack, top + slack + spanY] },
    { y: top, x: right, xs: [right - slack - spanX, right - slack], ys: [top + slack, top + slack + spanY] },
    { y: bottom, x: left, xs: [left + slack, left + slack + spanX], ys: [bottom - slack - spanY, bottom - slack] },
    { y: bottom, x: right, xs: [right - slack - spanX, right - slack], ys: [bottom - slack - spanY, bottom - slack] },
  ];
  let found = 0;
  for (const c of corners) {
    const horizontal = edgeAligned(img, "h", c.y, c.xs[0], c.xs[1], slack, band);
    const vertical = horizontal && edgeAligned(img, "v", c.x, c.ys[0], c.ys[1], slack, band);
    if (horizontal && vertical) found += 1;
  }
  return found;
}
