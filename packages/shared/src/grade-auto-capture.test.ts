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
  GRADE_AUTO_EXPLAINER,
  GRADE_AUTO_HINT_STABLE_MS,
  GRADE_LEVEL_EXIT_DEG,
  GRADE_AUTO_INITIAL,
  GRADE_AUTO_PROBE_BACKOFF_MS,
  GRADE_AUTO_PROBE_INTERVAL_MS,
  GRADE_AUTO_TOGGLE_DEFAULT,
  GRADE_STEADY_WINDOW,
  gradeAutoCaptureStep,
  gradeAutoHint,
  gradeAutoNoteCapture,
  gradeFrameFillInPhoto,
  gradeLevelHysteresis,
  gradeLevelStateHeld,
  gradeMotionSteady,
  gradeProbeIntervalMs,
  gradeProbePictureSize,
  gradeStableHint,
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
    cornerHitStreak: 2,
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

  it("corners: needs 2 four-corner probes in a row; any miss restarts the hold", () => {
    expect(run(every100(0, 2000, { cornerHitStreak: 1 })).fired).toEqual([]);
    const miss = run([
      ...every100(0, 300),
      { t: 400, cornersAllFoundAtMs: 0, cornerHitStreak: 0, cornerMissStreak: 1 },
      ...every100(500, 1300),
    ]);
    expect(miss.fired).toEqual([1200]);
    // Freshness counts from when the probe photo was taken, and covers a 1.5 s probe interval.
    expect(GRADE_AUTO_CORNERS_FRESH_MS).toBeGreaterThanOrEqual(GRADE_AUTO_PROBE_INTERVAL_MS + 500);
    expect(run(every100(0, 1000).map((tick) => ({ ...tick, cornersAllFoundAtMs: 0 }))).fired).toEqual([700]);
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
    // UX P1-9: an unfilled window doesn't flash "Keep the phone still" when the screen opens.
    const opening = gradeAutoCaptureStep(GRADE_AUTO_INITIAL, input({ t: 0, steady: null }));
    expect(gradeAutoHint(opening)).not.toBe(GRADE_AUTO_COPY.holdStill);
    expect(opening.fire).toBe(false);
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
    expect(during.progress).toBe(0); // ring hidden
    // UX P1-8: the chip shows the normal blocker during the cooldown.
    const blocked = gradeAutoCaptureStep({ ...GRADE_AUTO_INITIAL, cooldownUntilMs: 2700 }, input({ t: 1500, level: "near" }));
    expect(gradeAutoHint(blocked)).toBe(GRADE_AUTO_COPY.holdFlat);
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
    // Mobile Tech Lead 7: motion permission denied has its own hint.
    expect(
      gradeAutoHint(gradeAutoCaptureStep(GRADE_AUTO_INITIAL, input({ t: 0, sensorAvailable: false, motionDenied: true }))),
    ).toBe(GRADE_AUTO_COPY.motionDenied);
    expect(gradeAutoHint({ state: off.state, blocker: null })).toBe(GRADE_AUTO_COPY.offHint);
  });

  it("busy resets the hold but keeps the cooldown", () => {
    const step = gradeAutoCaptureStep(
      { phase: "holding", readySinceMs: 0, lastReadyMs: 500, cooldownUntilMs: 9000 },
      input({ t: 600, busy: true }),
    );
    expect(step.state).toEqual({ phase: "capturing", readySinceMs: null, lastReadyMs: null, cooldownUntilMs: 9000 });
  });
});

describe("UX review: hysteresis and stable hints", () => {
  it("enters level at ≤ 2.0° and leaves only above 2.5°", () => {
    expect(GRADE_LEVEL_EXIT_DEG).toBe(2.5);
    expect(gradeLevelHysteresis(false, 2.2)).toBe(false);
    expect(gradeLevelHysteresis(false, 2.0)).toBe(true);
    expect(gradeLevelHysteresis(true, 2.2)).toBe(true);
    expect(gradeLevelHysteresis(true, 2.6)).toBe(false);
    expect(gradeLevelHysteresis(true, null)).toBe(false);
    expect(gradeLevelStateHeld(true, 2.2)).toBe("level");
    expect(gradeLevelStateHeld(false, 2.2)).toBe("near");
    expect(gradeLevelStateHeld(false, 9)).toBe("off");
  });

  it("changes the chip phrase only after it's been stable for 300 ms", () => {
    expect(GRADE_AUTO_HINT_STABLE_MS).toBe(300);
    let h = gradeStableHint(null, "A", 0);
    h = gradeStableHint(h, "B", 100);
    expect(h.shown).toBe("A");
    h = gradeStableHint(h, "A", 200); // flicker back: never shows B
    h = gradeStableHint(h, "B", 300);
    h = gradeStableHint(h, "B", 500);
    expect(h.shown).toBe("A");
    h = gradeStableHint(h, "B", 600);
    expect(h.shown).toBe("B");
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
  it("probes at most every 1.5 s, backing off to 3 s after repeated misses", () => {
    expect(gradeProbeIntervalMs(0)).toBe(GRADE_AUTO_PROBE_INTERVAL_MS);
    expect(GRADE_AUTO_PROBE_INTERVAL_MS).toBeGreaterThanOrEqual(1500);
    expect(gradeProbeIntervalMs(5)).toBe(GRADE_AUTO_PROBE_BACKOFF_MS);
    expect(GRADE_AUTO_PROBE_BACKOFF_MS).toBe(3000);
  });

  it("picks a ≈VGA probe picture size (never the full size)", () => {
    expect(gradeProbePictureSize(["4032x3024", "1920x1080", "640x480", "320x240"])).toBe("640x480");
    expect(gradeProbePictureSize(["4000x3000", "1280x960", "800x600"])).toBe("800x600");
    expect(gradeProbePictureSize(["3840x2160", "1920x1080", "1280x720", "640x480", "Photo", "High", "Medium", "Low"])).toBe(
      "640x480",
    );
    expect(gradeProbePictureSize(["Photo", "High", "Medium"])).toBe("Medium");
    expect(gradeProbePictureSize(["Photo"])).toBeUndefined();
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

  it("Mobile Tech Lead 3: a patterned mat with no card fails; a card on the mat, a bit off the frame, passes", () => {
    const w = 192;
    const h = 256;
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const mat = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) mat[y * w + x] = ((x >> 2) + (y >> 2)) % 2 ? 40 + rand() * 120 : 20 + rand() * 60;
    }
    expect(gradeProbeCorners({ width: w, height: h, data: mat }, 0.55)).toBe(0);
    const withCard = Uint8Array.from(mat);
    const ch = Math.round(h * 0.55);
    const cw = Math.round(ch * (63 / 88));
    const left = Math.round((w - cw) / 2) + 3; // a few px off the drawn frame
    const top = Math.round((h - ch) / 2) - 2;
    for (let y = top; y < top + ch; y += 1) {
      for (let x = left; x < left + cw; x += 1) withCard[y * w + x] = 200 + ((x * 3 + y * 5) % 40);
    }
    expect(gradeProbeCorners({ width: w, height: h, data: withCard }, 0.55)).toBe(4);
  });
});

describe("Grade camera wiring (Expo Go)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (p: string) => readFileSync(resolve(here, "../../../apps/mobile", p), "utf8");
  const finder = read("components/ui/grade-card-finder.tsx");
  const hook = read("lib/use-grade-auto-capture.ts");
  const flow = read("components/ui/photo-grade-flow.tsx");
  const feedback = read("lib/use-grade-finder-feedback.ts");

  it("keeps a manual shutter, a haptic, a progress ring and an on/off switch", () => {
    expect(finder).toContain('accessibilityLabel="Take photo"');
    expect(finder).toContain('onShutter("manual")');
    expect(finder).toContain('onFire: () => void onShutter("auto")');
    expect(feedback).toContain("ImpactFeedbackStyle.Light");
    expect(finder).toContain("useLevelHaptic(level.level, manualMode, capturing);");
    expect(finder).toContain("<ProgressRing");
    expect(finder).toContain('accessibilityRole="switch"');
    expect(finder).toContain("accessibilityState={{ checked: auto.enabled }}");
    expect(finder).toContain("await auto.waitForProbe();");
    expect(finder).toContain("auto.noteCapture();");
    expect(finder).not.toMatch(/expo-sensors|Animated\.|withRepeat|useAnimatedStyle|react-native-svg/);
  });

  it("probes silently at a small size, only when focused, foregrounded and measured; goes manual on errors", () => {
    expect(hook).toContain("takePictureAsync({ quality: 0.1, shutterSound: false, exif: false })");
    expect(hook).toContain("createGradeProbeLoop(");
    expect(hook).toContain('AppState.addEventListener("change"');
    expect(hook).toMatch(/const probing =\s*active &&\s*appActive &&[\s\S]*probeSizeAvailable &&\s*layoutReady;/);
    expect(hook).toContain("onUnavailable: () => setDetectorAvailable(false)");
    expect(hook).not.toMatch(/expo-sensors|vision-camera|frame-processor/);
    expect(finder).toContain("const isFocused = useIsFocused();");
    expect(finder).toContain("active: isFocused && showLivePreview");
    expect(finder).toContain("const pictureSize = auto.probing && !capturing && probeSize ? probeSize : fullSize;");
    expect(finder).toContain("small = gradeProbePictureSize(sizes);");
  });

  it("UX P0-3: tap feedback before waiting for a probe; same capture haptic for auto and manual", () => {
    const shutter = finder.slice(finder.indexOf("async function onShutter("));
    expect(shutter.indexOf("setCapturing(true)")).toBeLessThan(shutter.indexOf("await auto.waitForProbe()"));
    expect(shutter.indexOf("NotificationFeedbackType.Success")).toBeLessThan(shutter.indexOf("await auto.waitForProbe()"));
    // The cooldown only gates auto: the manual guard never looks at the auto phase.
    expect(shutter.slice(0, shutter.indexOf("busyRef.current = true"))).not.toMatch(/auto\.|cooldown/);
  });

  it("UX P0-1 / P1: one chip phrase, scan toggle with On/Off text, hint, reduce motion, explainer", () => {
    expect(finder).toContain("const statusPhrase = capturing ? GRADE_AUTO_COPY.capturing : autoChip ? auto.hint : statusLine(readiness);");
    expect(finder).toContain('name="scan-outline"');
    expect(finder).not.toMatch(/name=\{auto\.enabled \? "flash"/);
    expect(finder).toContain("accessibilityHint={GRADE_AUTO_COPY.toggleHint}");
    expect(finder).toContain("holding && !reduceMotion ? <ProgressRing");
    expect(finder).toContain("auto.showExplainer ?");
    expect(finder).not.toMatch(/maxFontSizeMultiplier/);
    expect(GRADE_AUTO_EXPLAINER.ok).toBe("Got it");
  });

  it("still runs the blur check on every finder capture, auto or manual", () => {
    expect(flow).toContain("onCaptured={(still) => void ingestStill(side, still, true)}");
    expect(flow).toContain("await runDetect(nextSide, still, { fromGuide: fromFinder });");
    expect(flow).toContain("checkGradeStillOnPhone(still.uri, { fromGuide: phone.fromGuide })");
  });

  it("copy stays within the estimate rules and uses the review's wording", () => {
    expect(GRADE_AUTO_COPY.fitCorners).toBe("Fit all 4 corners inside the frame");
    expect(GRADE_AUTO_COPY.holdFlat).toBe("Hold your phone flat above the card");
    expect(GRADE_AUTO_COPY.holdStill).toBe("Keep the phone still");
    expect(GRADE_AUTO_COPY.holding).toBe("Hold it there…");
    expect("cooldown" in GRADE_AUTO_COPY).toBe(false);
    const all = [...Object.values(GRADE_AUTO_COPY), ...Object.values(GRADE_AUTO_EXPLAINER)].join(" ");
    expect(all).not.toMatch(/\bAI\b|PSA|BGS|CGC|grade|guarantee/i);
  });
});
