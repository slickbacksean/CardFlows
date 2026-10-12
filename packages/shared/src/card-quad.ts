/**
 * Shared card outline contract. Every card detector (the shipping card-finder
 * model, the classical contour finder, the iOS rectangle prototype, and the
 * test-only YOLO26n A/B baseline) reports this shape, and every consumer
 * (grading, the OpenCLIP identity crop, auto-capture) reads only this.
 *
 * Spec: services/card-finder/INTERFACE.md
 */

/** Card width / height, 63 x 88 mm. Same value as CARD_ASPECT_RATIO in grade-estimate. */
export const CARD_QUAD_ASPECT = 63 / 88;

/** Canonical warp every crop consumer uses: 63 x 88 mm at about 605 dpi. */
export const CARD_CANONICAL_WIDTH_PX = 1500;
export const CARD_CANONICAL_HEIGHT_PX = 2100;

/** [x, y] in source-image pixels, origin top-left, after EXIF orientation is applied. */
export type CardPoint = readonly [number, number];

/**
 * Virtual corners: intersections of the straight card edges (outside the rounded
 * corners), in order top-left, top-right, bottom-right, bottom-left of the card
 * as it reads upright. For a card lying sideways, "top" is still the card's top.
 */
export type CardCorners = readonly [CardPoint, CardPoint, CardPoint, CardPoint];

export type CardQuadSource = "card-finder" | "classical" | "vision-rect" | "yolo26n-ab";

export interface CardQuad {
  version: 1;
  source: CardQuadSource;
  /** Model or algorithm build, e.g. "card-finder@0.1.0". */
  sourceVersion: string;
  imageWidth: number;
  imageHeight: number;
  corners: CardCorners;
  /** 0..1, calibrated so that `confidence >= acceptThreshold` meets the wrong-crop bar. */
  confidence: number;
  /** True only when the detector stands behind the outline; false means retake or picker. */
  accepted: boolean;
  /** Out-of-plane angle of the card after the warp, degrees (null when unknown). */
  outOfPlaneDeg: number | null;
  /** Why it was not accepted, e.g. "corner_cut_off", "low_confidence", "aspect". */
  rejectReasons: readonly string[];
}

export function isCardQuad(value: unknown): value is CardQuad {
  if (value === null || typeof value !== "object") return false;
  const quad = value as Partial<CardQuad>;
  return (
    quad.version === 1 &&
    typeof quad.source === "string" &&
    typeof quad.imageWidth === "number" &&
    typeof quad.imageHeight === "number" &&
    Array.isArray(quad.corners) &&
    quad.corners.length === 4 &&
    quad.corners.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((n) => typeof n === "number" && Number.isFinite(n)),
    ) &&
    typeof quad.confidence === "number" &&
    typeof quad.accepted === "boolean"
  );
}

/** Scale corners from one image size to another (e.g. preview frame to full-res still). */
export function scaleCardCorners(
  corners: CardCorners,
  from: { width: number; height: number },
  to: { width: number; height: number },
): CardCorners {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return corners.map(([x, y]) => [x * sx, y * sy] as const) as unknown as CardCorners;
}
