/**
 * Sean (Oct 18): two grade types. Quick = 2 photos (front flat + back flat). Full = guided
 * 7 photos per side (14 total): 1 flat, 2 tilted ~15-25° in opposite directions, 4 corner
 * close-ups. Full is not Premium-locked: it has its own monthly allowance (free 2, Premium
 * 25), counted per account per allowance period like the quick estimates, with no bought-credit
 * spending. Behind CARD_FLOW_GRADE_FULL_MODE=on on the server until it's ready (off by default).
 *
 * What the grader uses (see docs/GRADE_FULL_MODE.md): only the flat photos. The tilted
 * shots can't feed its surface solve (that needs 3+ shots with the light moving relative to
 * the card; tilting the phone moves the camera, not the light), and it has no input for
 * corner close-ups. The extras are blur-checked on the phone and accepted by the server.
 */
import type { GradeSide } from "./grade-estimate";

export type GradeExtraShot = "tilt_a" | "tilt_b" | "corner_tl" | "corner_tr" | "corner_br" | "corner_bl";
export type GradeFullShot = "flat" | GradeExtraShot;

export const GRADE_EXTRA_SHOTS: readonly GradeExtraShot[] = [
  "tilt_a",
  "tilt_b",
  "corner_tl",
  "corner_tr",
  "corner_br",
  "corner_bl",
];
export const GRADE_FULL_SHOTS: readonly GradeFullShot[] = ["flat", ...GRADE_EXTRA_SHOTS];
export const GRADE_FULL_SHOTS_PER_SIDE = GRADE_FULL_SHOTS.length;

export function isGradeExtraShot(value: unknown): value is GradeExtraShot {
  return typeof value === "string" && (GRADE_EXTRA_SHOTS as readonly string[]).includes(value);
}

/** Tilt window for the two tilted shots (degrees from flat). */
export const GRADE_TILT_SHOT_MIN_DEG = 15;
export const GRADE_TILT_SHOT_MAX_DEG = 25;

export const GRADE_FULL_COPY = {
  modeTitle: "Full pre-grade (14 photos)",
  modeBody: "7 photos per side: flat, two tilted, and four corner close-ups. Estimate only. Not an official grade.",
  startFull: "Start full grade",
  startQuick: "Quick 2-photo grade",
  usedUp: "You've used this month's full grades. The quick 2-photo grade is still available.",
  usedUpMidway: "You've used this month's full grades. Tap Try again for the quick 2-photo grade.",
  prompts: {
    flat: "Hold the phone flat over the card.",
    tilt_a: "Tilt the phone about 20° toward you, keeping the card in view.",
    tilt_b: "Now tilt about 20° the other way, away from you.",
    corner_tl: "Close-up: fit the top-left corner in the box.",
    corner_tr: "Close-up: fit the top-right corner in the box.",
    corner_br: "Close-up: fit the bottom-right corner in the box.",
    corner_bl: "Close-up: fit the bottom-left corner in the box.",
  } satisfies Record<GradeFullShot, string>,
  tiltMore: "Tilt a little more",
  tiltLess: "Tilt a little less",
  tiltHold: "Hold it there…",
  cornerTap: "Tap the shutter when the corner is sharp.",
  blurry: "Too blurry. Move back a little and retake.",
  use: "Use this photo",
  retake: "Retake",
  sendFailed: "Couldn't send this photo. Try again.",
} as const;

/** "Front 3/7": `index` is the 0-based position in GRADE_FULL_SHOTS. */
export function gradeFullProgressLabel(side: GradeSide, index: number): string {
  const n = Math.min(Math.max(1, index + 1), GRADE_FULL_SHOTS_PER_SIDE);
  return `${side === "front" ? "Front" : "Back"} ${n}/${GRADE_FULL_SHOTS_PER_SIDE}`;
}

/** Tilted-shot hint, or null when the phone is inside the 15-25° window. */
export function gradeTiltShotHint(tiltDeg: number | null | undefined): string | null {
  if (tiltDeg == null || !Number.isFinite(tiltDeg)) return GRADE_FULL_COPY.tiltMore;
  if (tiltDeg < GRADE_TILT_SHOT_MIN_DEG) return GRADE_FULL_COPY.tiltMore;
  if (tiltDeg > GRADE_TILT_SHOT_MAX_DEG) return GRADE_FULL_COPY.tiltLess;
  return null;
}

/** Full grades per allowance period (Sean, Oct 18). Same reset date as the quick estimates. */
export const GRADE_FULL_FREE_PER_MONTH = 2;
export const GRADE_FULL_PREMIUM_PER_MONTH = 25;
export const OUT_OF_FULL_GRADES_CODE = "out_of_full_grades";

export function gradeFullMonthlyLimit(plan: "free" | "premium"): number {
  return plan === "premium" ? GRADE_FULL_PREMIUM_PER_MONTH : GRADE_FULL_FREE_PER_MONTH;
}

/** Full-grade usage lives next to the quick usage, under its own period key. */
export function gradeFullUsageKey(periodKey: string): string {
  return `${periodKey}#full`;
}

export interface GradeFullAllowance {
  monthlyLimit: number;
  usedThisMonth: number;
  remaining: number;
}

export function gradeFullAllowance(plan: "free" | "premium", usedThisMonth: number): GradeFullAllowance {
  const monthlyLimit = gradeFullMonthlyLimit(plan);
  return { monthlyLimit, usedThisMonth, remaining: Math.max(0, monthlyLimit - usedThisMonth) };
}

/** "2 full grades left this month" (shown before a full grade starts). */
export function gradeFullRemainingCaption(allowance: GradeFullAllowance): string {
  const n = allowance.remaining;
  return `${n} full grade${n === 1 ? "" : "s"} left this month`;
}

/** Dev/test flag: CARD_FLOW_GRADE_FULL_MODE=on. Off by default. */
export function gradeFullModeEnabled(flag: string | undefined): boolean {
  return flag?.trim().toLowerCase() === "on";
}
