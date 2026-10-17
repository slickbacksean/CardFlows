import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GRADE_AUTO_CAPTURE_HOLD_MS,
  GRADE_AUTO_COOLDOWN_MS,
  GRADE_AUTO_COPY,
  GRADE_AUTO_CORNERS_FRESH_MS,
  GRADE_AUTO_DEBOUNCE_MS,
  GRADE_AUTO_INITIAL,
  GRADE_AUTO_PROBE_BACKOFF_MS,
  GRADE_AUTO_PROBE_INTERVAL_MS,
  GRADE_AUTO_TOGGLE_DEFAULT,
  GRADE_STEADY_WINDOW,
  gradeAutoCaptureStep,
  gradeAutoHint,
  gradeAutoNoteCapture,
  gradeFrameFillInPhoto,
  gradeMotionSteady,
  gradeProbeIntervalMs,
  type GradeAutoInput,
  type GradeAutoState,
} from "./grade-auto-capture";
import { GRADE_LEVEL_OK_DEG, gradeLevelState } from "./grade-capture-guide";
import { gradeProbeCorners, type GrayImage } from "./phone-photo-check";

type Tick = Partial<GradeAutoInput> & { t: number };

/** Every condition met unless a tick overrides it; corners were found "just now". */
function input(tick: Tick): GradeAutoInput {
  return {
    enabled: true,
    sensorAvailable: true,
    detectorAvailable: true,
    cornersAllFoundAtMs: tick.t,
    cornerMissStreak: 0,
    level: "level",
    steady: true,
    busy: false,
    nowMs: tick.t,
    ...tick,
  };
}

function run(ticks: Tick[], start: GradeAutoState = GRADE_AUTO_INITIAL) {
  let state = start;
  const fired: number[] = [];
  const phases: string[] = [];
  let progress = 0;
  for (const tick of ticks) {
    const step = gradeAutoCaptureStep(state, input(tick));
    state = step.state;
    phases.push(step.state.phase);
    progress = step.progress;
    if (step.fire) fired.push(tick.t);
  }
  return { fired, phases, state, progress };
}

const every100 = (from: number, to: number, extra: Partial<GradeAutoInput> = {}): Tick[] =>
  Array.from({ length: Math.floor((to - from) / 100) + 1 }, (_, i) => ({ t: from + i * 100, ...extra }));

describe("auto-capture constants", () => {
  it("holds ~0.7 s, reuses the 2° tilt tolerance, and defaults on", () => {
    expect(GRADE_AUTO_CAPTURE_HOLD_MS).toBe(700);
    expect(GRADE_LEVEL_OK_DEG).toBe(2);
    expect(gradeLevelState(2)).toBe("level");
    expect(gradeLevelState(2.1)).not.toBe("level");
    expect(GRADE_AUTO_TOGGLE_DEFAULT).toBe(true);
    expect(GRADE_AUTO_COOLDOWN_MS).toBeGreaterThan(GRADE_AUTO_CAPTURE_HOLD_MS);
  });
});

describe("readiness state machine", () => {
  it("fires once after 0.7 s with corners, level and steady, not before", () => {
    const out = run(every100(0, 1000));
    expect(out.fired).toEqual([700]);
    expect(out.phases.slice(0, 7).every((p) => p === "holding")).toBe(true);
    expect(out.phases[7]).toBe("capturing");
  });

  it("reports ring progress during the hold", () => {
    expect(run(every100(0, 300)).progress).toBeCloseTo(300 / 700);
    expect(run(every100(0, 600)).progress).toBeCloseTo(600 / 700);
  });

  it("corners: never fires without all 4 corners, or when the 4-corner result is stale", () => {
    expect(run(every100(0, 1500, { cornersAllFoundAtMs: null })).fired).toEqual([]);
    // Found once at t=0 and never again: stale after GRADE_AUTO_CORNERS_FRESH_MS.
    const stale = run(every100(0, 3000).map((tick) => ({ ...tick, cornersAllFoundAtMs: -GRADE_AUTO_CORNERS_FRESH_MS })));
    expect(stale.fired).toEqual([]);
    const step = gradeAutoCaptureStep(GRADE_AUTO_INITIAL, input({ t: 0, cornersAllFoundAtMs: null }));
    expect(step.blocker).toBe("corners");
    expect(gradeAutoHint(step)).toBe(GRADE_AUTO_COPY.fitCorners);
  });

  it("corners: one flaky probe doesn't cancel a hold, two misses in a row do", () => {
    const oneMiss = run([
      ...every100(0, 300),
      { t: 400, cornersAllFoundAtMs: 300, cornerMissStreak: 1 },
      ...every100(500, 800),
    ]);
    expect(oneMiss.fired).toEqual([700]);
    const twoMisses = run([
      ...every100(0, 300),
      { t: 400, cornersAllFoundAtMs: 300, cornerMissStreak: 2 },
      ...every100(500, 1300),
    ]);
    expect(twoMisses.fired).toEqual([1200]);
  });

  it("level: never fires while tilted past the tolerance", () => {
    expect(run(every100(0, 2000, { level: "near" })).fired).toEqual([]);
    expect(run(every100(0, 2000, { level: "off" })).fired).toEqual([]);
    const step = gradeAutoCaptureStep(GRADE_AUTO_INITIAL, input({ t: 0, level: "near" }));
    expect(gradeAutoHint(step)).toBe(GRADE_AUTO_COPY.holdFlat);
  });

  it("steady: never fires while moving or before the motion window fills", () => {
    expect(run(every100(0, 2000, { steady: false })).fired).toEqual([]);
    expect(run(every100(0, 2000, { steady: null })).fired).toEqual([]);
    const step = gradeAutoCaptureStep(GRADE_AUTO_INITIAL, input({ t: 0, steady: false }));
    expect(gradeAutoHint(step)).toBe(GRADE_AUTO_COPY.holdStill);
  });

  it("debounce: a level/steady flicker shorter than the debounce keeps the hold", () => {
    const out = run([
      ...every100(0, 400),
      { t: 450, steady: false }, // 50 ms after the last good tick
      ...every100(500, 900),
    ]);
    expect(out.fired).toEqual([700]);
    expect(GRADE_AUTO_DEBOUNCE_MS).toBe(250);
  });

  it("debounce: a break longer than the debounce restarts the hold", () => {
    const out = run([
      ...every100(0, 400),
      { t: 500, level: "near" },
      { t: 600, level: "near" },
      { t: 700, level: "near" }, // 300 ms since the last good tick
      ...every100(800, 1600),
    ]);
    expect(out.fired).toEqual([1500]);
  });

  it("debounce never fires on a tick that isn't ready", () => {
    const step = gradeAutoCaptureStep(
      { phase: "holding", readySinceMs: 0, lastReadyMs: 690, cooldownUntilMs: 0 },
      input({ t: 750, steady: false }),
    );
    expect(step.fire).toBe(false);
    expect(step.state.phase).toBe("holding");
  });

  it("cooldown: no second shot right after a capture, then a fresh 0.7 s hold", () => {
    const out = run(every100(0, 4000));
    expect(out.fired[0]).toBe(700);
    expect(out.fired[1]).toBe(700 + GRADE_AUTO_COOLDOWN_MS + GRADE_AUTO_CAPTURE_HOLD_MS);
    const during = gradeAutoCaptureStep(
      { ...GRADE_AUTO_INITIAL, cooldownUntilMs: 2700 },
      input({ t: 1500 }),
    );
    expect(during.state.phase).toBe("cooldown");
    expect(during.fire).toBe(false);
  });

  it("cooldown also follows a manual capture (e.g. a retake)", () => {
    const after = gradeAutoNoteCapture(GRADE_AUTO_INITIAL, 1000);
    expect(after.phase).toBe("cooldown");
    expect(run(every100(1000, 4000), after).fired).toEqual([1000 + GRADE_AUTO_COOLDOWN_MS + GRADE_AUTO_CAPTURE_HOLD_MS]);
  });

  it("never fires while busy, switched off, or without the sensor or the corner check (manual only)", () => {
    expect(run(every100(0, 2000, { busy: true })).fired).toEqual([]);
    expect(run(every100(0, 2000, { busy: true })).phases.at(-1)).toBe("capturing");
    const off = run(every100(0, 2000, { enabled: false }));
    expect(off.fired).toEqual([]);
    expect(off.phases.at(-1)).toBe("off");
    const noSensor = run(every100(0, 2000, { sensorAvailable: false }));
    expect(noSensor.fired).toEqual([]);
    expect(noSensor.phases.at(-1)).toBe("unavailable");
    expect(run(every100(0, 2000, { detectorAvailable: false })).fired).toEqual([]);
    expect(gradeAutoHint(gradeAutoCaptureStep(GRADE_AUTO_INITIAL, input({ t: 0, detectorAvailable: false })))).toBe(
      GRADE_AUTO_COPY.unavailable,
    );
  });

  it("busy resets the hold but keeps the cooldown", () => {
    const step = gradeAutoCaptureStep(
      { phase: "holding", readySinceMs: 0, lastReadyMs: 500, cooldownUntilMs: 9000 },
      input({ t: 600, busy: true }),
    );
    expect(step.state).toEqual({ phase: "capturing", readySinceMs: null, lastReadyMs: null, cooldownUntilMs: 9000 });
  });
});

describe("steady from motion variance", () => {
  const still = { gyro: 1, accel: 0.02 };
  it("needs a full ~0.7 s window", () => {
    expect(GRADE_STEADY_WINDOW).toBe(7);
    expect(gradeMotionSteady(Array(6).fill(still))).toBeNull();
    expect(gradeMotionSteady(Array(7).fill(still))).toBe(true);
    expect(gradeMotionSteady(Array(7).fill({ gyro: null, accel: null }))).toBeNull();
  });
  it("fails on gyro energy or accelerometer variance over the threshold", () => {
    expect(gradeMotionSteady(Array(7).fill({ gyro: 15, accel: 0.02 }))).toBe(false);
    const shaky = [0.1, 0.6, 0.1, 0.7, 0.1, 0.6, 0.1].map((accel) => ({ gyro: 1, accel }));
    expect(gradeMotionSteady(shaky)).toBe(false);
    // Only the accelerometer reports (some Android phones): still decides.
    expect(gradeMotionSteady(Array(7).fill({ gyro: null, accel: 0.05 }))).toBe(true);
  });
});

describe("throttle and frame mapping", () => {
  it("probes at most every 0.9 s, backing off to 1.8 s after repeated misses", () => {
    expect(gradeProbeIntervalMs(0)).toBe(GRADE_AUTO_PROBE_INTERVAL_MS);
    expect(GRADE_AUTO_PROBE_INTERVAL_MS).toBeGreaterThanOrEqual(900);
    expect(gradeProbeIntervalMs(5)).toBe(GRADE_AUTO_PROBE_BACKOFF_MS);
  });

  it("maps the on-screen frame into the cover-fitted photo", () => {
    // Stage 390x500, photo 3024x4032 (scale = max(0.129, 0.124) = 0.129): frame 300 px → 0.577 of the photo.
    expect(
      gradeFrameFillInPhoto({ stageWidth: 390, stageHeight: 500, frameHeight: 300, photoWidth: 3024, photoHeight: 4032 }),
    ).toBeCloseTo(300 / (390 / 3024) / 4032, 4);
    expect(gradeFrameFillInPhoto({ stageWidth: 0, stageHeight: 500, frameHeight: 300, photoWidth: 3, photoHeight: 4 })).toBeNull();
  });

  it("counts 4 corners on a card filling the frame, 0 on an empty or blurry still", () => {
    const w = 192;
    const h = 256;
    const card: GrayImage = { width: w, height: h, data: new Uint8Array(w * h).fill(30) };
    const ch = Math.round(h * 0.55);
    const cw = Math.round(ch * (63 / 88));
    const left = Math.round((w - cw) / 2);
    const top = Math.round((h - ch) / 2);
    for (let y = top; y < top + ch; y += 1) {
      for (let x = left; x < left + cw; x += 1) card.data[y * w + x] = ((x >> 1) + (y >> 1)) % 2 ? 230 : 150;
    }
    expect(gradeProbeCorners(card, 0.55)).toBe(4);
    expect(gradeProbeCorners({ width: w, height: h, data: new Uint8Array(w * h).fill(128) }, 0.55)).toBe(0);
  });
});

describe("Grade camera wiring (Expo Go)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (p: string) => readFileSync(resolve(here, "../../../apps/mobile", p), "utf8");
  const finder = read("components/ui/grade-card-finder.tsx");
  const hook = read("lib/use-grade-auto-capture.ts");
  const flow = read("components/ui/photo-grade-flow.tsx");

  it("keeps a manual shutter, a haptic, a progress ring and an on/off switch", () => {
    expect(finder).toContain('accessibilityLabel="Take photo"');
    expect(finder).toContain('onShutter("manual")');
    expect(finder).toContain('onFire: () => void onShutter("auto")');
    expect(finder).toContain("ImpactFeedbackStyle.Light");
    expect(finder).toContain("<ProgressRing");
    expect(finder).toContain('accessibilityRole="switch"');
    expect(finder).toContain("accessibilityState={{ checked: auto.enabled }}");
    expect(finder).toContain("await auto.waitForProbe();");
    expect(finder).toContain("auto.noteCapture();");
    expect(finder).not.toMatch(/expo-sensors|Animated\.|withRepeat|useAnimatedStyle|react-native-svg/);
  });

  it("probes silently and small, throttled, and goes manual after repeated probe errors", () => {
    expect(hook).toContain("takePictureAsync({ quality: 0.1, shutterSound: false, exif: false })");
    expect(hook).toContain("gradeProbeIntervalMs(cornersRef.current.missStreak)");
    expect(hook).toContain('AppState.currentState !== "active"');
    expect(hook).toContain("GRADE_AUTO_PROBE_MAX_ERRORS");
    expect(hook).toContain("setDetectorAvailable(false)");
    expect(hook).not.toMatch(/expo-sensors|vision-camera|frame-processor/);
  });

  it("still runs the blur check on every finder capture, auto or manual", () => {
    expect(flow).toContain("onCaptured={(still) => void ingestStill(side, still, true)}");
    expect(flow).toContain("await runDetect(nextSide, still, { fromGuide: fromFinder });");
    expect(flow).toContain("checkGradeStillOnPhone(still.uri, { fromGuide: phone.fromGuide })");
  });

  it("copy stays within the estimate rules", () => {
    const all = Object.values(GRADE_AUTO_COPY).join(" ");
    expect(all).not.toMatch(/\bAI\b|PSA|BGS|CGC|grade|guarantee/i);
  });
});
