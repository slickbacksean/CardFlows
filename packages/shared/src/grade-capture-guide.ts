/**
 * Live capture guide for Grade tab photos: card frame geometry, level
 * (phone tilt) state, and a readiness verdict the grade camera uses to
 * auto-capture. Pure functions, no React Native, so they are unit-tested here.
 *
 * The vendored cardgrading detector hard-fails a photo whose card corners
 * deviate more than 2° from square (calibration/thresholds.json
 * max_corner_angle_deviation_deg). Phone tilt is the main cause, so the level
 * indicator uses the same 2° as "good".
 */

/** Pokémon / standard TCG card, 63 x 88 mm (width / height ≈ 0.716). */
export const GRADE_CARD_ASPECT = 63 / 88;
/** Matches cardgrading max_corner_angle_deviation_deg. */
export const GRADE_LEVEL_OK_DEG = 2;
/** Above this the phone is clearly not flat. Between OK and this: amber. */
export const GRADE_LEVEL_NEAR_DEG = 6;
/** Card frame height as a share of the preview height (target 60-80% fill). */
export const GRADE_FRAME_HEIGHT_FILL = 0.72;
/** Never wider than this share of the preview width. */
export const GRADE_FRAME_MAX_WIDTH_FILL = 0.8;
/** Smoothed rotation rate (deg/s) under which the phone counts as steady. */
export const GRADE_STEADY_MAX_DEG_PER_S = 10;

export type GradeLevelState = "unknown" | "level" | "near" | "off";

export const GRADE_GUIDE_COPY = {
  lineUp: "Line up the card inside the frame",
  holdFlat: "Hold flat",
  looksGood: "Looks good",
  noSensor: "Hold the phone flat, straight over the card",
} as const;

export interface GradeFrameSize {
  width: number;
  height: number;
}

/**
 * Card-shaped guide frame centered in a preview of the given size.
 * `fill` = the card's long side as a share of the preview height (same
 * physical scale in both orientations, so a landscape card in the surface
 * step is held at the same distance as an upright one).
 */
export function gradeGuideFrame(
  previewWidth: number,
  previewHeight: number,
  fill: number = GRADE_FRAME_HEIGHT_FILL,
  orientation: "portrait" | "landscape" = "portrait",
): GradeFrameSize {
  if (!(previewWidth > 0) || !(previewHeight > 0)) return { width: 0, height: 0 };
  const longSide = previewHeight * fill;
  let width = orientation === "portrait" ? longSide * GRADE_CARD_ASPECT : longSide;
  let height = orientation === "portrait" ? longSide : longSide * GRADE_CARD_ASPECT;
  const maxWidth = previewWidth * GRADE_FRAME_MAX_WIDTH_FILL;
  if (width > maxWidth) {
    const shrink = maxWidth / width;
    width *= shrink;
    height *= shrink;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/* ------------------------------ sharp capture ----------------------------- */

/**
 * Why grade photos were soft (2026-10-05): expo-camera captures with the
 * single wide lens, which can't focus closer than ~15-20 cm, and the 72%
 * frame pulled the phone to ~10 cm. The fix keeps the phone ~25 cm away and
 * fills the frame with ~2x zoom instead (the system camera does the same by
 * switching to macro, which expo-camera can't).
 */
export const GRADE_TARGET_ZOOM_FACTOR = 2;
/** expo-camera iOS zoom used for the one-off calibration probe. */
export const GRADE_ZOOM_PROBE = 0.1;
/** Card long side / preview height. Zoomed ≈ 25 cm away; wide (1x) ≈ 20 cm. */
export const GRADE_FRAME_FILL = { zoomed: 0.55, wide: 0.3 } as const;
/** Autofocus scan + lock before the photo. */
export const GRADE_FOCUS_SETTLE_MS = 700;
/** How long the shutter waits for the phone to be still. */
export const GRADE_STEADY_WAIT_MS = 2500;

/**
 * expo-camera (iOS) sets videoZoomFactor = maxZoom ^ zoom, and maxZoom is not
 * exposed to JS. A probe photo at a known `probeZoom` reports EXIF
 * DigitalZoomRatio = maxZoom ^ probeZoom, which pins the curve:
 * zoom(target) = probeZoom * ln(target) / ln(ratio). Null when the probe
 * gave nothing usable or the phone can't reach the target.
 */
export function gradeZoomFromProbe(probeZoom: number, probeRatio: number, targetFactor: number): number | null {
  if (!(probeZoom > 0) || !(targetFactor > 1) || !Number.isFinite(probeRatio)) return null;
  if (probeRatio <= 1.01) return null;
  const zoom = (probeZoom * Math.log(targetFactor)) / Math.log(probeRatio);
  if (!Number.isFinite(zoom) || zoom <= 0 || zoom > 1) return null;
  return Math.round(zoom * 10000) / 10000;
}

/** What the server's debug log gets about each capture. No image data. */
export interface GradeCaptureMeta {
  zoom?: number | null;
  zoomMode?: "zoomed" | "wide" | null;
  digitalZoomRatio?: number | null;
  focalLength35mm?: number | null;
  exposureTime?: number | null;
  iso?: number | null;
  lensModel?: string | null;
  steady?: boolean | null;
  tiltDeg?: number | null;
  torch?: boolean | null;
  width?: number | null;
  height?: number | null;
}

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Pull the few EXIF fields that explain a soft photo (zoom, lens, shutter speed). */
export function captureMetaFromExif(exif: unknown): GradeCaptureMeta {
  if (!exif || typeof exif !== "object") return {};
  const e = exif as Record<string, unknown>;
  const iso = Array.isArray(e.ISOSpeedRatings) ? e.ISOSpeedRatings[0] : e.ISOSpeedRatings;
  return {
    digitalZoomRatio: finiteOrNull(e.DigitalZoomRatio),
    focalLength35mm: finiteOrNull(e.FocalLenIn35mmFilm),
    exposureTime: finiteOrNull(e.ExposureTime),
    iso: finiteOrNull(iso),
    lensModel: typeof e.LensModel === "string" ? e.LensModel.slice(0, 80) : null,
  };
}

export const GRADE_CAPTURE_COPY = {
  setup: "Setting up the camera…",
  holdStill: "Hold still…",
  focusing: "Focusing…",
  notSteady: "Hold the phone still, then tap again.",
  tapToFocus: "Tap the preview to refocus.",
  autoCapture: "Hold still — capturing",
  distanceZoomed: "Hold the phone about 25 cm (10 in) above the card.",
  distanceWide: "Hold the phone about 20 cm (8 in) above the card.",
  torchGlare: "Flashlight on: watch for a bright glare spot. Room light is usually better.",
} as const;

/* --------------------------- optional surface step ------------------------- */

/**
 * Surface (scratches, creases) needs light from several directions. The
 * vendored grader's surface path is photometric stereo: the camera stays
 * put, one low lamp stays put, and the card is turned a quarter-turn
 * clockwise between photos. Tilting the phone instead doesn't work: the
 * light would not move relative to the card, and the grader rejects tilted
 * photos. So this step keeps the phone flat (same level guide) and turns the
 * card.
 */
export const GRADE_ANGLED_SHOTS = 4;
export const GRADE_ANGLED_MIN_SHOTS = 3;

export const GRADE_ANGLED_COPY = {
  title: "Surface photos (optional)",
  intro:
    "To check the front for scratches and creases, take 4 more photos of the front under one low lamp.",
  how: [
    "Put one lamp low, about 30 cm (1 ft) from the card, beyond its top edge. Other lights off if you can.",
    "Keep the phone flat and in the same spot.",
    "Turn the card a quarter-turn clockwise before each photo.",
  ],
  skipNote: "Skip this and surface stays not assessed.",
  start: "Add surface photos",
  skip: "Skip, grade now",
  gradeWith: (count: number) => `Grade with ${count} surface photos`,
  step: (index: number, total: number) => `Surface photo ${index + 1} of ${total}`,
  firstShot: "Card upright, lamp beyond its top edge",
  turnCard: "Turn the card a quarter-turn clockwise. Keep the phone still.",
} as const;

const RAD_TO_DEG = 180 / Math.PI;

export interface GradeTilt {
  /** Forward/back tilt (rotation about the phone's X axis), degrees. */
  pitchDeg: number;
  /** Left/right tilt (rotation about the phone's Y axis), degrees. */
  rollDeg: number;
  /** Angle between the phone's screen normal and straight up, degrees. */
  tiltDeg: number;
}

/**
 * Tilt from DeviceMotion `rotation` (radians; beta = about X, gamma = about
 * Y). Lying flat, screen up, is beta = gamma = 0. Total tilt is the angle of
 * the screen normal from vertical: acos(cos β · cos γ).
 */
export function tiltFromRotation(beta: number, gamma: number): GradeTilt | null {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  const cos = Math.min(1, Math.max(-1, Math.cos(beta) * Math.cos(gamma)));
  return {
    pitchDeg: beta * RAD_TO_DEG,
    rollDeg: gamma * RAD_TO_DEG,
    tiltDeg: Math.acos(Math.abs(cos)) * RAD_TO_DEG,
  };
}

/**
 * Tilt from `accelerationIncludingGravity` (m/s²). Sign conventions differ
 * between iOS and Android, so only magnitudes decide the level state.
 */
export function tiltFromGravity(x: number, y: number, z: number): GradeTilt | null {
  const g = Math.hypot(x, y, z);
  if (!Number.isFinite(g) || g < 1) return null;
  const az = Math.abs(z);
  return {
    pitchDeg: Math.atan2(y, az) * RAD_TO_DEG,
    rollDeg: Math.atan2(x, az) * RAD_TO_DEG,
    tiltDeg: Math.acos(Math.min(1, az / g)) * RAD_TO_DEG,
  };
}

export function gradeLevelState(tiltDeg: number | null | undefined): GradeLevelState {
  if (tiltDeg == null || !Number.isFinite(tiltDeg)) return "unknown";
  if (tiltDeg <= GRADE_LEVEL_OK_DEG) return "level";
  if (tiltDeg <= GRADE_LEVEL_NEAR_DEG) return "near";
  return "off";
}

export interface GradeCaptureReadinessInput {
  /** False when the motion sensor isn't in this build / device. */
  sensorAvailable: boolean;
  level: GradeLevelState;
  steady: boolean | null;
  /** Card seen inside the frame with 4 corners. null = no detector yet. */
  cardInFrame: boolean | null;
}

export interface GradeCaptureReadiness {
  /** Every known check passes. */
  ready: boolean;
  /** Level and still. A missing card locator does not block this; a detected miss does. */
  autoCaptureReady: boolean;
  /** Short status line for the overlay. */
  status: string;
  tone: "good" | "warn" | "bad" | "neutral";
}

export function gradeCaptureReadiness(input: GradeCaptureReadinessInput): GradeCaptureReadiness {
  if (input.cardInFrame === false) {
    return { ready: false, autoCaptureReady: false, status: GRADE_GUIDE_COPY.lineUp, tone: "neutral" };
  }
  if (!input.sensorAvailable || input.level === "unknown") {
    return { ready: false, autoCaptureReady: false, status: GRADE_GUIDE_COPY.noSensor, tone: "neutral" };
  }
  if (input.level === "off") {
    return { ready: false, autoCaptureReady: false, status: GRADE_GUIDE_COPY.holdFlat, tone: "bad" };
  }
  if (input.level === "near") {
    return { ready: false, autoCaptureReady: false, status: GRADE_GUIDE_COPY.holdFlat, tone: "warn" };
  }
  if (input.steady === false) {
    return { ready: false, autoCaptureReady: false, status: "Hold still", tone: "warn" };
  }
  return {
    ready: true,
    // No live card locator in Expo Go. The on-screen frame is the target, so a
    // level, steady phone is enough. An explicit miss (cardInFrame === false)
    // still blocks, via the early return above.
    autoCaptureReady: input.steady === true,
    status: GRADE_GUIDE_COPY.looksGood,
    tone: "good",
  };
}

/** How long the phone must stay level (≤ 2°) and still before the shutter fires (P1-15: 0.5 s). */
export const GRADE_AUTO_CAPTURE_HOLD_MS = 500;

/** True once a level, still pose has been held long enough to auto-capture. */
export function gradeAutoCaptureHold(input: {
  autoCaptureReady: boolean;
  readySinceMs: number | null;
  nowMs: number;
  holdMs?: number;
}): boolean {
  if (!input.autoCaptureReady || input.readySinceMs == null) return false;
  const holdMs = input.holdMs ?? GRADE_AUTO_CAPTURE_HOLD_MS;
  return input.nowMs - input.readySinceMs >= holdMs;
}

/* --------------------------- P1-15 auto-capture --------------------------- */

export interface GradeAutoCaptureState {
  /** When the current level-and-still pose started, or null. */
  readySinceMs: number | null;
  /** True after a shot fired for this pose; the pose must break before the next. */
  firedThisPose: boolean;
}

export const GRADE_AUTO_CAPTURE_INITIAL: GradeAutoCaptureState = { readySinceMs: null, firedThisPose: false };

export const GRADE_AUTO_CAPTURE_COPY = {
  holding: "Hold it there…",
  capturing: "Taking photo",
  manualHint: "Or tap the shutter any time",
} as const;

/**
 * One sensor tick. Returns the next state and whether to fire now. Never
 * fires while the camera is busy or auto-capture is off; manual shutter is
 * separate and always works.
 */
export function gradeAutoCaptureStep(
  state: GradeAutoCaptureState,
  input: { autoCaptureReady: boolean; enabled: boolean; busy: boolean; nowMs: number; holdMs?: number },
): { state: GradeAutoCaptureState; fire: boolean; holdProgress: number } {
  if (!input.enabled || !input.autoCaptureReady) {
    return { state: GRADE_AUTO_CAPTURE_INITIAL, fire: false, holdProgress: 0 };
  }
  const readySinceMs = state.readySinceMs ?? input.nowMs;
  const holdMs = input.holdMs ?? GRADE_AUTO_CAPTURE_HOLD_MS;
  const held = input.nowMs - readySinceMs;
  const holdProgress = Math.max(0, Math.min(1, held / holdMs));
  if (state.firedThisPose || input.busy) {
    return { state: { readySinceMs, firedThisPose: state.firedThisPose }, fire: false, holdProgress };
  }
  const fire = held >= holdMs;
  return { state: { readySinceMs, firedThisPose: fire }, fire, holdProgress };
}
