import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GRADE_AUTO_CAPTURE_HOLD_MS,
  GRADE_AUTO_CAPTURE_INITIAL,
  GRADE_CARD_ASPECT,
  GRADE_LEVEL_OK_DEG,
  gradeAutoCaptureStep,
  gradeCaptureReadiness,
  gradeLevelState,
  type GradeAutoCaptureState,
} from "./grade-capture-guide";

function run(ticks: Array<{ t: number; ready: boolean; busy?: boolean; enabled?: boolean }>) {
  let state: GradeAutoCaptureState = GRADE_AUTO_CAPTURE_INITIAL;
  const fired: number[] = [];
  for (const tick of ticks) {
    const step = gradeAutoCaptureStep(state, {
      autoCaptureReady: tick.ready, enabled: tick.enabled ?? true, busy: tick.busy ?? false, nowMs: tick.t,
    });
    state = step.state;
    if (step.fire) fired.push(tick.t);
  }
  return fired;
}

describe("P1-15 auto-capture", () => {
  it("uses 2° level, 0.5 s hold and the 63:88 card", () => {
    expect(GRADE_LEVEL_OK_DEG).toBe(2);
    expect(GRADE_AUTO_CAPTURE_HOLD_MS).toBe(500);
    expect(GRADE_CARD_ASPECT).toBeCloseTo(63 / 88);
    expect(gradeLevelState(2)).toBe("level");
    expect(gradeLevelState(2.1)).not.toBe("level");
  });

  it("needs level and steady before it can fire", () => {
    expect(gradeCaptureReadiness({ sensorAvailable: true, level: "level", steady: true, cardInFrame: null }).autoCaptureReady).toBe(true);
    expect(gradeCaptureReadiness({ sensorAvailable: true, level: "level", steady: null, cardInFrame: null }).autoCaptureReady).toBe(false);
    expect(gradeCaptureReadiness({ sensorAvailable: true, level: "near", steady: true, cardInFrame: null }).autoCaptureReady).toBe(false);
    expect(gradeCaptureReadiness({ sensorAvailable: false, level: "unknown", steady: null, cardInFrame: null }).autoCaptureReady).toBe(false);
  });

  it("fires once after 0.5 s held, not before", () => {
    const ticks = [0, 100, 200, 300, 400, 500, 600, 700].map((t) => ({ t, ready: true }));
    expect(run(ticks)).toEqual([500]);
  });

  it("restarts the hold if the pose breaks, and can fire again on a new pose", () => {
    expect(run([
      { t: 0, ready: true }, { t: 400, ready: false }, { t: 500, ready: true },
      { t: 900, ready: true }, { t: 1000, ready: true }, { t: 1100, ready: false },
      { t: 1200, ready: true }, { t: 1700, ready: true },
    ])).toEqual([1000, 1700]);
  });

  it("never fires while busy or switched off", () => {
    expect(run([{ t: 0, ready: true, busy: true }, { t: 600, ready: true, busy: true }])).toEqual([]);
    expect(run([{ t: 0, ready: true, enabled: false }, { t: 900, ready: true, enabled: false }])).toEqual([]);
  });

  it("finder keeps a manual shutter, a light haptic, and reaches sensors only via the safe loader", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const finder = readFileSync(resolve(here, "../../../apps/mobile/components/ui/grade-card-finder.tsx"), "utf8");
    expect(finder).toContain('accessibilityLabel="Take photo"');
    expect(finder).toContain('onShutter("manual")');
    expect(finder).toContain("ImpactFeedbackStyle.Light");
    expect(finder).toContain("useGradeAutoCapture");
    expect(finder).not.toMatch(/expo-sensors|Animated\.|withRepeat|useAnimatedStyle/);
  });
});
