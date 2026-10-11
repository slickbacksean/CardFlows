/**
 * Photo pre-grade contract for the free, offline cardgrading library
 * (vendored at apps/api/vendor/cardgrading). Mirrors the GitHub
 * packages/api photo-pregrade-mapper body. No model call is on this path.
 */
import { PREGRADE_COPY, PREGRADE_DISCLAIMER_TEXT, PREGRADE_TITLE } from "./pregrade-copy";

export const PREGRADE_LABEL = PREGRADE_TITLE;
export const PREGRADE_DISCLAIMER = PREGRADE_DISCLAIMER_TEXT;
export const PHOTO_PREGRADE_SOURCE = "cardgrading-photo" as const;
export const PREGRADE_SURFACE_NULL_REASON = PREGRADE_COPY.surfaceNotAssessed;
export const PREGRADE_UNAVAILABLE_MESSAGE = "Photo scoring is unavailable." as const;
export const PREGRADE_DETECT_UNAVAILABLE_MESSAGE = "Card detection is not available." as const;

export type PhotoPregradeSide = "front" | "back";

export interface PhotoPregradeSubgrade {
  /** Combined 0–100 points. Null when the library did not grade it. */
  points: number | null;
  front: number | null;
  back: number | null;
  reason?: string;
}

export interface PhotoPregradeSubgrades {
  centering: PhotoPregradeSubgrade;
  corners: PhotoPregradeSubgrade;
  edges: PhotoPregradeSubgrade;
  surface: PhotoPregradeSubgrade;
}

export interface PhotoPregradeSuccess {
  ok: true;
  status: "scored";
  label: typeof PREGRADE_LABEL;
  disclaimer: typeof PREGRADE_DISCLAIMER;
  source: typeof PHOTO_PREGRADE_SOURCE;
  /** `grade_estimate.overall_grade` only. 1.0–10.0. */
  estimate: number;
  subgrades: PhotoPregradeSubgrades;
  note: string;
  warning?: string;
  /** Per-side capture measurements (sharpness, effective DPI). Diagnostics only. */
  capture?: Partial<Record<PhotoPregradeSide, PhotoCaptureMetrics>>;
  /** What happened to the optional raking-light front photos. */
  angled?: PhotoPregradeAngled;
}

/** Measured on the card in one photo. Never a grade input on its own. */
export interface PhotoCaptureMetrics {
  /** Laplacian variance of the card face at a fixed 750x1050 size. */
  sharpness: number | null;
  /** Capture pixels per inch across the card, from its known 63 x 88 mm size. */
  effectiveDpi: number | null;
}

export type PhotoPregradeAngledStatus =
  | "not_provided"
  | "graded"
  | "rejected"
  | "no_light_change"
  | "solve_failed";

export interface PhotoPregradeAngled {
  provided: number;
  used: number;
  status: PhotoPregradeAngledStatus;
}

/** Hard gate (card not found, tilt, aspect) or no grade. Never a number. */
export interface PhotoPregradeRetake {
  ok: false;
  status: "retake";
  code: "PHOTO_RETAKE";
  side: PhotoPregradeSide;
  reasons: string[];
}

/** Grader missing, crashed, or timed out. Never a number. */
export interface PhotoPregradeUnavailable {
  ok: false;
  status: "unavailable";
  code: "UNAVAILABLE";
  message: string;
}

export type PhotoPregradeResult =
  | PhotoPregradeSuccess
  | PhotoPregradeRetake
  | PhotoPregradeUnavailable;

export interface DetectedCardCrop {
  mimeType: "image/jpeg";
  base64: string;
}

export interface DetectCropSuccess {
  ok: true;
  status: "found";
  side: PhotoPregradeSide;
  crop: DetectedCardCrop;
  /** Soft gates (glare, lighting, resolution). The photo can still be graded. */
  warnings: string[];
  capture?: PhotoCaptureMetrics;
}

export interface DetectCropRetake {
  ok: false;
  status: "retake";
  code: "PHOTO_RETAKE";
  side: PhotoPregradeSide;
  reasons: string[];
  crop?: DetectedCardCrop;
  capture?: PhotoCaptureMetrics;
}

export interface DetectCropUnavailable {
  ok: false;
  status: "unavailable";
  code: "UNAVAILABLE";
  side: PhotoPregradeSide;
  message: string;
}

export type DetectCropResult = DetectCropSuccess | DetectCropRetake | DetectCropUnavailable;
