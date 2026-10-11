/**
 * Auto-capture rule for the live card finder (step 3).
 *
 * Fires once the on-device finder has reported a steady, square, sharp,
 * glare-free card for AUTO_CAPTURE_HOLD_MS of consecutive frames. Square comes from
 * the opposite-edge ratio of the quad itself, which tells us the camera is parallel
 * to the card, even when the card isn't lying flat. The accelerometer level only
 * works for a card on a table, so it is a hint, not a gate.
 */
import type { CardCorners, CardQuad } from "./card-quad";

export const AUTO_CAPTURE_HOLD_MS = 500;
export const AUTO_CAPTURE_MIN_CONFIDENCE = 0.8;
/** Card area as a share of the frame. */
export const AUTO_CAPTURE_MIN_AREA = 0.35;
/** Corners must stay this far inside the frame (share of the short side). */
export const AUTO_CAPTURE_EDGE_MARGIN = 0.03;
/** Max corner movement between frames, share of the frame diagonal. */
export const AUTO_CAPTURE_MAX_JITTER = 0.005;
export const AUTO_CAPTURE_EDGE_RATIO_MIN = 0.97;
export const AUTO_CAPTURE_EDGE_RATIO_MAX = 1.03;

export interface CaptureFrame {
  timestampMs: number;
  quad: CardQuad | null;
  /** Variance of the Laplacian on the card crop, or null when not measured. */
  sharpness: number | null;
  /** Share of card pixels blown out (0..1), or null when not measured. */
  glare: number | null;
}

export type CaptureHint =
  | "find_card"
  | "move_closer"
  | "fit_whole_card"
  | "hold_square"
  | "hold_still"
  | "too_blurry"
  | "glare"
  | "ready";

export const AUTO_CAPTURE_MIN_SHARPNESS = 60;
export const AUTO_CAPTURE_MAX_GLARE = 0.005;

function distance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function polygonArea(c: CardCorners): number {
  let sum = 0;
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = c[i];
    const [x2, y2] = c[(i + 1) % 4];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Opposite-edge length ratios (top/bottom, left/right). Both near 1 means the camera is parallel to the card. */
export function edgeRatios(c: CardCorners): { horizontal: number; vertical: number } {
  return {
    horizontal: distance(c[0], c[1]) / Math.max(distance(c[3], c[2]), 1e-6),
    vertical: distance(c[0], c[3]) / Math.max(distance(c[1], c[2]), 1e-6),
  };
}

/** Why this single frame is not capture-ready, or "ready". Jitter needs two frames; see `nextCaptureState`. */
export function frameHint(frame: CaptureFrame): CaptureHint {
  const quad = frame.quad;
  if (!quad || !quad.accepted || quad.confidence < AUTO_CAPTURE_MIN_CONFIDENCE) return "find_card";
  const { imageWidth: w, imageHeight: h, corners } = quad;
  const margin = AUTO_CAPTURE_EDGE_MARGIN * Math.min(w, h);
  if (corners.some(([x, y]) => x < margin || y < margin || x > w - margin || y > h - margin)) {
    return "fit_whole_card";
  }
  if (polygonArea(corners) / (w * h) < AUTO_CAPTURE_MIN_AREA) return "move_closer";
  const { horizontal, vertical } = edgeRatios(corners);
  const square = (r: number) => r >= AUTO_CAPTURE_EDGE_RATIO_MIN && r <= AUTO_CAPTURE_EDGE_RATIO_MAX;
  if (!square(horizontal) || !square(vertical)) return "hold_square";
  if (frame.sharpness !== null && frame.sharpness < AUTO_CAPTURE_MIN_SHARPNESS) return "too_blurry";
  if (frame.glare !== null && frame.glare > AUTO_CAPTURE_MAX_GLARE) return "glare";
  return "ready";
}

export interface CaptureState {
  readySinceMs: number | null;
  last: CaptureFrame | null;
  hint: CaptureHint;
  fire: boolean;
}

export const INITIAL_CAPTURE_STATE: CaptureState = { readySinceMs: null, last: null, hint: "find_card", fire: false };

export function cornerJitter(a: CardQuad, b: CardQuad): number {
  const diag = Math.hypot(b.imageWidth, b.imageHeight);
  let worst = 0;
  for (let i = 0; i < 4; i += 1) worst = Math.max(worst, distance(a.corners[i], b.corners[i]) / diag);
  return worst;
}

export function nextCaptureState(state: CaptureState, frame: CaptureFrame): CaptureState {
  let hint = frameHint(frame);
  if (hint === "ready" && state.last?.quad && frame.quad && cornerJitter(state.last.quad, frame.quad) > AUTO_CAPTURE_MAX_JITTER) {
    hint = "hold_still";
  }
  if (hint !== "ready") return { readySinceMs: null, last: frame, hint, fire: false };
  const since = state.readySinceMs ?? frame.timestampMs;
  return { readySinceMs: since, last: frame, hint, fire: frame.timestampMs - since >= AUTO_CAPTURE_HOLD_MS };
}

/** Short on-screen guidance. */
export const CAPTURE_HINT_COPY: Record<CaptureHint, string> = {
  find_card: "Place one card in the frame",
  move_closer: "Move closer",
  fit_whole_card: "Fit the whole card in the frame",
  hold_square: "Hold the phone square to the card",
  hold_still: "Hold still",
  too_blurry: "Hold still, focusing",
  glare: "Tilt slightly to remove glare",
  ready: "Looks good",
};
