/**
 * Grade camera auto-capture (Sean, Oct 17, 2026). Pure logic, no React Native.
 *
 * The full-resolution shutter fires on its own once, at the same time:
 *  - the card is inside the green frame with all 4 corners found (the shared
 *    on-phone check, run on a small throttled preview still),
 *  - the phone is level (GRADE_LEVEL_OK_DEG, the existing tilt tolerance),
 *  - the phone is steady (motion variance under a threshold),
 * and that has held for GRADE_AUTO_CAPTURE_HOLD_MS (about 0.7 s). The manual
 * shutter always works. Without the motion sensor or the corner check it's
 * manual only.
 */
import { GRADE_CARD_ASPECT, GRADE_STEADY_MAX_DEG_PER_S, type GradeLevelState } from "./grade-capture-guide";

/** Level, steady and all 4 corners held this long before the shutter fires. */
export const GRADE_AUTO_CAPTURE_HOLD_MS = 700;
/** Brief level/steady flickers shorter than this don't restart the hold. */
export const GRADE_AUTO_DEBOUNCE_MS = 250;
/** No auto-capture for this long after any capture (auto or manual), e.g. after a retake. */
export const GRADE_AUTO_COOLDOWN_MS = 2000;
/** A 4-corner result older than this no longer counts. */
export const GRADE_AUTO_CORNERS_FRESH_MS = 1500;
/** This many corner misses in a row cancel a hold (one flaky probe doesn't). */
export const GRADE_AUTO_CORNER_MISS_CANCEL = 2;
/** All 4 frame corners must show a card edge. */
export const GRADE_AUTO_CORNERS_REQUIRED = 4;
/** After this many probe errors in a row the corner check counts as unavailable (manual only). */
export const GRADE_AUTO_PROBE_MAX_ERRORS = 3;
/** Corner probe throttle: one small still at most this often... */
export const GRADE_AUTO_PROBE_INTERVAL_MS = 900;
/** ...and this often after GRADE_AUTO_PROBE_BACKOFF_AFTER misses in a row (saves battery and heat). */
export const GRADE_AUTO_PROBE_BACKOFF_MS = 1800;
export const GRADE_AUTO_PROBE_BACKOFF_AFTER = 5;

/** Motion window for "steady": about the hold length at the 100 ms sensor rate. */
export const GRADE_STEADY_WINDOW = 7;
/** Variance of |acceleration| (m/s², gravity removed) under which the phone is steady. */
export const GRADE_STEADY_ACCEL_VAR_MAX = 0.04;
/** Mean square rotation rate under which the phone is steady ((deg/s)²). */
export const GRADE_STEADY_GYRO_MS_MAX = GRADE_STEADY_MAX_DEG_PER_S * GRADE_STEADY_MAX_DEG_PER_S;

export const GRADE_AUTO_TOGGLE_DEFAULT = true;

export const GRADE_AUTO_COPY = {
  toggleLabel: "Auto-capture",
  on: "Auto on",
  off: "Auto off",
  fitCorners: "Fit all 4 corners in the frame",
  holdFlat: "Hold flat",
  holdStill: "Hold still",
  holding: "Hold steady…",
  capturing: "Taking photo",
  cooldown: "One moment…",
  offHint: "Auto-capture is off. Tap the shutter.",
  unavailable: "Auto-capture isn't available here. Tap the shutter.",
  manualHint: "Or tap the shutter any time",
} as const;

export interface MotionSample {
  /** |rotation rate|, deg/s; null when the sensor didn't report it. */
  gyro: number | null;
  /** |acceleration| without gravity, m/s²; null when not reported. */
  accel: number | null;
}

/**
 * Steady from the last GRADE_STEADY_WINDOW motion samples: the gyro mean
 * square and the accelerometer variance must both be under their thresholds.
 * null until the window is full or when neither sensor reports.
 */
export function gradeMotionSteady(window: readonly MotionSample[]): boolean | null {
  if (window.length < GRADE_STEADY_WINDOW) return null;
  const recent = window.slice(-GRADE_STEADY_WINDOW);
  const gyro = recent.map((s) => s.gyro).filter((v): v is number => v != null && Number.isFinite(v));
  const accel = recent.map((s) => s.accel).filter((v): v is number => v != null && Number.isFinite(v));
  if (gyro.length < GRADE_STEADY_WINDOW && accel.length < GRADE_STEADY_WINDOW) return null;
  if (gyro.length === GRADE_STEADY_WINDOW) {
    const meanSquare = gyro.reduce((sum, v) => sum + v * v, 0) / gyro.length;
    if (meanSquare > GRADE_STEADY_GYRO_MS_MAX) return false;
  }
  if (accel.length === GRADE_STEADY_WINDOW) {
    const mean = accel.reduce((sum, v) => sum + v, 0) / accel.length;
    const variance = accel.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / accel.length;
    if (variance > GRADE_STEADY_ACCEL_VAR_MAX) return false;
  }
  return true;
}

/** How long to wait before the next corner probe. */
export function gradeProbeIntervalMs(missStreak: number): number {
  return missStreak >= GRADE_AUTO_PROBE_BACKOFF_AFTER ? GRADE_AUTO_PROBE_BACKOFF_MS : GRADE_AUTO_PROBE_INTERVAL_MS;
}

/**
 * The on-screen green frame as a share of the photo height, so the corner
 * check looks where the user sees the frame. The preview is cover-fitted into
 * the stage, so the photo is scaled by max(stageW/photoW, stageH/photoH).
 */
export function gradeFrameFillInPhoto(input: {
  stageWidth: number;
  stageHeight: number;
  frameHeight: number;
  photoWidth: number;
  photoHeight: number;
}): number | null {
  const { stageWidth, stageHeight, frameHeight, photoWidth, photoHeight } = input;
  if (![stageWidth, stageHeight, frameHeight, photoWidth, photoHeight].every((n) => Number.isFinite(n) && n > 0)) {
    return null;
  }
  const scale = Math.max(stageWidth / photoWidth, stageHeight / photoHeight);
  const fill = frameHeight / scale / photoHeight;
  // The frame must still fit inside the photo width at the card aspect.
  if (!(fill > 0) || fill * photoHeight * GRADE_CARD_ASPECT > photoWidth) return null;
  return Math.min(1, fill);
}

export type GradeAutoPhase = "off" | "unavailable" | "searching" | "holding" | "capturing" | "cooldown";
export type GradeAutoBlocker = "corners" | "level" | "steady" | null;

export interface GradeAutoInput {
  /** The user's Auto toggle. */
  enabled: boolean;
  /** Motion sensor present (level + steady can be known). */
  sensorAvailable: boolean;
  /** Corner check usable (camera ready and probes not failing). */
  detectorAvailable: boolean;
  /** When the last probe found all 4 corners, or null. */
  cornersAllFoundAtMs: number | null;
  /** Probes in a row that found fewer than 4 corners. */
  cornerMissStreak: number;
  level: GradeLevelState;
  steady: boolean | null;
  /** Camera busy (taking the full photo, checking it, or not ready). */
  busy: boolean;
  nowMs: number;
}

export interface GradeAutoState {
  phase: GradeAutoPhase;
  /** Start of the current hold, or null. */
  readySinceMs: number | null;
  /** Last tick where every condition held (for the debounce). */
  lastReadyMs: number | null;
  /** No auto-capture before this time. */
  cooldownUntilMs: number;
}

export const GRADE_AUTO_INITIAL: GradeAutoState = {
  phase: "searching",
  readySinceMs: null,
  lastReadyMs: null,
  cooldownUntilMs: 0,
};

export interface GradeAutoStep {
  state: GradeAutoState;
  /** Fire the full-resolution capture now. */
  fire: boolean;
  /** 0..1 for the progress ring. */
  progress: number;
  /** What's still missing, for the hint line. */
  blocker: GradeAutoBlocker;
}

export function gradeAutoCornersOk(input: Pick<GradeAutoInput, "cornersAllFoundAtMs" | "cornerMissStreak" | "nowMs">): boolean {
  return (
    input.cornersAllFoundAtMs != null &&
    input.nowMs - input.cornersAllFoundAtMs <= GRADE_AUTO_CORNERS_FRESH_MS &&
    input.cornerMissStreak < GRADE_AUTO_CORNER_MISS_CANCEL
  );
}

function blockerOf(input: GradeAutoInput): GradeAutoBlocker {
  if (!gradeAutoCornersOk(input)) return "corners";
  if (input.level !== "level") return "level";
  if (input.steady !== true) return "steady";
  return null;
}

/**
 * One tick (every sensor update and every corner probe). Returns the next
 * state, whether to fire, the ring progress and what's missing.
 */
export function gradeAutoCaptureStep(state: GradeAutoState, input: GradeAutoInput): GradeAutoStep {
  const reset = (phase: GradeAutoPhase, blocker: GradeAutoBlocker = null): GradeAutoStep => ({
    state: { phase, readySinceMs: null, lastReadyMs: null, cooldownUntilMs: state.cooldownUntilMs },
    fire: false,
    progress: 0,
    blocker,
  });
  if (!input.enabled) return reset("off");
  if (!input.sensorAvailable || !input.detectorAvailable) return reset("unavailable");
  if (input.busy) return reset("capturing");
  if (input.nowMs < state.cooldownUntilMs) return reset("cooldown");

  const blocker = blockerOf(input);
  if (blocker) {
    const withinDebounce =
      state.readySinceMs != null && state.lastReadyMs != null && input.nowMs - state.lastReadyMs <= GRADE_AUTO_DEBOUNCE_MS;
    // Corners are debounced by the miss streak instead, so a corner miss always ends the hold.
    if (withinDebounce && blocker !== "corners") {
      const held = state.lastReadyMs! - state.readySinceMs!;
      return {
        state: { ...state, phase: "holding" },
        fire: false,
        progress: clamp01(held / GRADE_AUTO_CAPTURE_HOLD_MS),
        blocker,
      };
    }
    return reset("searching", blocker);
  }

  const readySinceMs = state.readySinceMs ?? input.nowMs;
  const held = input.nowMs - readySinceMs;
  if (held >= GRADE_AUTO_CAPTURE_HOLD_MS) {
    return {
      state: {
        phase: "capturing",
        readySinceMs: null,
        lastReadyMs: null,
        cooldownUntilMs: input.nowMs + GRADE_AUTO_COOLDOWN_MS,
      },
      fire: true,
      progress: 1,
      blocker: null,
    };
  }
  return {
    state: { phase: "holding", readySinceMs, lastReadyMs: input.nowMs, cooldownUntilMs: state.cooldownUntilMs },
    fire: false,
    progress: clamp01(held / GRADE_AUTO_CAPTURE_HOLD_MS),
    blocker: null,
  };
}

/** Any capture (manual too) starts the cooldown, so a retake isn't shot again at once. */
export function gradeAutoNoteCapture(state: GradeAutoState, nowMs: number): GradeAutoState {
  return { phase: "cooldown", readySinceMs: null, lastReadyMs: null, cooldownUntilMs: nowMs + GRADE_AUTO_COOLDOWN_MS };
}

/** Hint line for the overlay chip. */
export function gradeAutoHint(step: Pick<GradeAutoStep, "state" | "blocker">): string {
  switch (step.state.phase) {
    case "off":
      return GRADE_AUTO_COPY.offHint;
    case "unavailable":
      return GRADE_AUTO_COPY.unavailable;
    case "capturing":
      return GRADE_AUTO_COPY.capturing;
    case "holding":
      return GRADE_AUTO_COPY.holding;
    case "cooldown":
      return GRADE_AUTO_COPY.cooldown;
    case "searching":
      if (step.blocker === "level") return GRADE_AUTO_COPY.holdFlat;
      if (step.blocker === "steady") return GRADE_AUTO_COPY.holdStill;
      return GRADE_AUTO_COPY.fitCorners;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
