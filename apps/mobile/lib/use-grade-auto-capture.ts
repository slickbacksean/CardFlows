import {
  GRADE_AUTO_CORNER_MISS_CANCEL,
  GRADE_AUTO_CORNERS_REQUIRED,
  GRADE_AUTO_INITIAL,
  GRADE_AUTO_PROBE_MAX_ERRORS,
  GRADE_AUTO_TOGGLE_DEFAULT,
  gradeAutoCaptureStep,
  gradeAutoCornersOk,
  gradeAutoHint,
  gradeAutoNoteCapture,
  gradeProbeIntervalMs,
  type GradeAutoPhase,
} from "@cardflow/shared";
import type { CameraView } from "expo-camera";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { AppState, Platform } from "react-native";
import type { DeviceLevel } from "@/lib/device-level";
import { probeGradeCorners } from "@/lib/phone-photo-check";

/**
 * Grade camera auto-capture (Sean, Oct 17, 2026). Fires `onFire` once the
 * card's 4 corners are in the green frame, the phone is level and steady,
 * and that has held ~0.7 s (state machine in @cardflow/shared
 * grade-auto-capture). Expo Go only: the corner check runs on a small,
 * silent preview still taken at most every ~0.9 s (1.8 s after repeated
 * misses), and only while the phone isn't clearly tilted or moving, so it
 * doesn't heat the phone. If the sensor or the corner check is unavailable
 * it stays manual. The manual shutter always works.
 */

const PREF_KEY = "cardflow.grade.autoCapture";
let cachedPref: boolean | null = null;

async function loadAutoPref(): Promise<boolean> {
  if (cachedPref != null) return cachedPref;
  try {
    const raw = Platform.OS === "web" ? null : await SecureStore.getItemAsync(PREF_KEY);
    cachedPref = raw == null ? GRADE_AUTO_TOGGLE_DEFAULT : raw === "1";
  } catch {
    cachedPref = GRADE_AUTO_TOGGLE_DEFAULT;
  }
  return cachedPref;
}

function saveAutoPref(on: boolean) {
  cachedPref = on;
  if (Platform.OS === "web") return;
  void SecureStore.setItemAsync(PREF_KEY, on ? "1" : "0").catch(() => {});
}

export interface GradeAutoCapture {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  phase: GradeAutoPhase;
  /** 0..1 for the ring. */
  progress: number;
  hint: string;
  /** true: all 4 corners found; false: card clearly not lined up; null: unknown. */
  cardInFrame: boolean | null;
  /** Call before the full-resolution shutter so it never overlaps a probe. */
  waitForProbe: () => Promise<void>;
  /** Any capture (manual too) starts the cooldown. */
  noteCapture: () => void;
}

export function useGradeAutoCapture(input: {
  cameraRef: RefObject<CameraView | null>;
  /** Live preview showing, camera ready, nothing frozen. */
  active: boolean;
  level: DeviceLevel;
  busy: boolean;
  /** Green frame as a share of a probe photo's height, from the preview layout. */
  frameFill: (photoWidth: number, photoHeight: number) => number | null;
  onFire: () => void;
}): GradeAutoCapture {
  const { cameraRef, active, level, busy } = input;
  const [enabled, setEnabledState] = useState(cachedPref ?? GRADE_AUTO_TOGGLE_DEFAULT);
  const [detectorAvailable, setDetectorAvailable] = useState(true);
  const [probeTick, setProbeTick] = useState(0);
  const [view, setView] = useState<{ phase: GradeAutoPhase; progress: number; hint: string }>({
    phase: "searching",
    progress: 0,
    hint: "",
  });
  const stateRef = useRef(GRADE_AUTO_INITIAL);
  const cornersRef = useRef<{ allFoundAtMs: number | null; missStreak: number; errorStreak: number }>({
    allFoundAtMs: null,
    missStreak: 0,
    errorStreak: 0,
  });
  const probeRef = useRef<Promise<void> | null>(null);
  const latest = useRef({ level, busy, onFire: input.onFire, frameFill: input.frameFill });
  useEffect(() => {
    latest.current = { level, busy, onFire: input.onFire, frameFill: input.frameFill };
  });

  useEffect(() => {
    let cancelled = false;
    void loadAutoPref().then((on) => {
      if (!cancelled) setEnabledState(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    saveAutoPref(on);
    setEnabledState(on);
  }, []);

  // Throttled corner probe loop.
  const probing = active && enabled && level.available && detectorAvailable;
  useEffect(() => {
    if (!probing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(() => void run(), gradeProbeIntervalMs(cornersRef.current.missStreak));
    };
    const run = async () => {
      const { level: lv, busy: isBusy } = latest.current;
      // Skip the probe (no camera work) while busy, backgrounded, or clearly tilted/moving.
      const worthIt = lv.level === "level" || lv.level === "near";
      if (isBusy || AppState.currentState !== "active" || !worthIt || lv.steady === false || !cameraRef.current) {
        schedule();
        return;
      }
      const job = (async () => {
        let found: number | null = null;
        try {
          const shot = await cameraRef.current?.takePictureAsync({ quality: 0.1, shutterSound: false, exif: false });
          if (shot?.uri) {
            found = await probeGradeCorners(shot.uri, latest.current.frameFill(shot.width, shot.height));
          }
        } catch {
          found = null;
        }
        const c = cornersRef.current;
        if (found == null) {
          c.errorStreak += 1;
          if (c.errorStreak >= GRADE_AUTO_PROBE_MAX_ERRORS && !cancelled) setDetectorAvailable(false);
        } else {
          c.errorStreak = 0;
          if (found >= GRADE_AUTO_CORNERS_REQUIRED) {
            c.allFoundAtMs = Date.now();
            c.missStreak = 0;
          } else {
            c.missStreak += 1;
          }
        }
      })();
      probeRef.current = job;
      await job;
      if (probeRef.current === job) probeRef.current = null;
      if (cancelled) return;
      setProbeTick((n) => n + 1);
      schedule();
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [probing, cameraRef]);

  // One state-machine tick per sensor update (~100 ms) and per probe result.
  useEffect(() => {
    const c = cornersRef.current;
    const step = gradeAutoCaptureStep(stateRef.current, {
      enabled,
      sensorAvailable: level.available,
      detectorAvailable: detectorAvailable && active,
      cornersAllFoundAtMs: c.allFoundAtMs,
      cornerMissStreak: c.missStreak,
      level: level.level,
      steady: level.steady,
      busy,
      nowMs: Date.now(),
    });
    stateRef.current = step.state;
    setView((prev) => {
      const hint = gradeAutoHint(step);
      return prev.phase === step.state.phase && prev.progress === step.progress && prev.hint === hint
        ? prev
        : { phase: step.state.phase, progress: step.progress, hint };
    });
    if (step.fire) latest.current.onFire();
  }, [level, busy, enabled, detectorAvailable, active, probeTick]);

  const waitForProbe = useCallback(async () => {
    try {
      await probeRef.current;
    } catch {
      // a failed probe never blocks the shutter
    }
  }, []);

  const noteCapture = useCallback(() => {
    stateRef.current = gradeAutoNoteCapture(stateRef.current, Date.now());
    cornersRef.current = { allFoundAtMs: null, missStreak: 0, errorStreak: cornersRef.current.errorStreak };
  }, []);

  const c = cornersRef.current;
  const cardInFrame = gradeAutoCornersOk({ cornersAllFoundAtMs: c.allFoundAtMs, cornerMissStreak: c.missStreak, nowMs: Date.now() })
    ? true
    : c.missStreak >= GRADE_AUTO_CORNER_MISS_CANCEL
      ? false
      : null;

  return { enabled, setEnabled, phase: view.phase, progress: view.progress, hint: view.hint, cardInFrame, waitForProbe, noteCapture };
}
