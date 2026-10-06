/**
 * Photo pre-grade contract for the free, offline cardgrading library
 * (vendored at apps/api/vendor/cardgrading). Mirrors the GitHub
 * packages/api photo-pregrade-mapper body. No model call is on this path.
 */
export const PREGRADE_LABEL = "AI pre-grade estimate" as const;
export const PREGRADE_DISCLAIMER = "Not an official PSA, BGS, or CGC grade." as const;
export const PHOTO_PREGRADE_SOURCE = "cardgrading-photo" as const;
export const PREGRADE_SURFACE_NULL_REASON = "single-image relief is not graded" as const;
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
}

export interface DetectCropRetake {
  ok: false;
  status: "retake";
  code: "PHOTO_RETAKE";
  side: PhotoPregradeSide;
  reasons: string[];
  crop?: DetectedCardCrop;
}

export interface DetectCropUnavailable {
  ok: false;
  status: "unavailable";
  code: "UNAVAILABLE";
  side: PhotoPregradeSide;
  message: string;
}

export type DetectCropResult = DetectCropSuccess | DetectCropRetake | DetectCropUnavailable;
