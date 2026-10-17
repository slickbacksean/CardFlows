import {
  createGradeProbeLoop,
  GRADE_AUTO_CORNER_HITS_REQUIRED,
  GRADE_AUTO_CORNER_MISS_CANCEL,
  GRADE_AUTO_INITIAL,
  GRADE_AUTO_TOGGLE_DEFAULT,
  gradeAutoCaptureStep,
  gradeAutoHint,
  gradeAutoNoteCapture,
  gradeStableHint,
  type GradeAutoPhase,
  type GradeProbeLoop,
  type GradeProbeStats,
  type StableHint,
} from "@cardflow/shared";
import type { CameraView } from "expo-camera";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { AppState, Platform } from "react-native";
import type { DeviceLevel } from "@/lib/device-level";
import { probeGradeCorners } from "@/lib/phone-photo-check";

/**
 * Grade camera auto-capture (Sean, Oct 17, 2026). Fires `onFire` once two
 * probes in a row find the card's 4 corners lined up with the green frame,
 * and the phone has been level and steady for ~0.7 s (state machine in
 * @cardflow/shared grade-auto-capture).
 *
 * Expo Go only. The corner check runs on a small (≈VGA) silent preview still,
 * at most every 1.5 s (3 s after repeated misses), only while the screen is
 * focused, the app is in the foreground, the preview layout is measured and
 * the phone isn't clearly tilted or moving (createGradeProbeLoop). Without the
 * motion sensor (or its permission) or the corner check it stays manual. The
 * manual shutter always works.
 */

const PREF_KEY = "cardflow.grade.autoCapture";
const EXPLAINER_KEY = "cardflow.grade.autoCaptureExplained";
let cachedPref: boolean | null = null;
let cachedExplained: boolean | null = null;

async function readFlag(key: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: string) {
  if (Platform.OS === "web") return;
  void SecureStore.setItemAsync(key, value).catch(() => {});
}

export interface GradeAutoCapture {
  enabled: boolean;
  /** False until the saved Auto choice has loaded (the toggle stays hidden so it doesn't flash "On"). */
  prefLoaded: boolean;
  setEnabled: (on: boolean) => void;
  /** Show the one-time explainer (first Grade camera with Auto on). Auto waits until it's dismissed. */
  showExplainer: boolean;
  dismissExplainer: () => void;
  phase: GradeAutoPhase;
  /** 0..1 for the ring. */
  progress: number;
  /** The chip phrase, changed only after it has been stable for 300 ms (no re-announcing on flicker). */
  hint: string;
  /** true: corners found; false: card clearly not lined up; null: unknown. */
  cardInFrame: boolean | null;
  /** Probing at the small picture size right now (the finder switches to full size for the shot). */
  probing: boolean;
  /** Call before the full-resolution shutter so it doesn't overlap a probe (waits 1.5 s at most). */
  waitForProbe: () => Promise<void>;
  /** Any capture (manual too) starts the cooldown and resets the corner streak. */
  noteCapture: () => void;
}

export function useGradeAutoCapture(input: {
  cameraRef: RefObject<CameraView | null>;
  /** Screen focused, live preview showing, camera ready, nothing frozen. */
  active: boolean;
  /** A small probe picture size exists (else the corner check can't run). */
  probeSizeAvailable: boolean;
  level: DeviceLevel;
  busy: boolean;
  /** Green frame as a share of a probe photo's height; null until the preview layout is measured. */
  frameFill: (photoWidth: number, photoHeight: number) => number | null;
  /** The preview layout has been measured. */
  layoutReady: boolean;
  onFire: () => void;
}): GradeAutoCapture {
  const { cameraRef, active, level, busy, probeSizeAvailable, layoutReady } = input;
  const [enabled, setEnabledState] = useState(cachedPref ?? GRADE_AUTO_TOGGLE_DEFAULT);
  const [prefLoaded, setPrefLoaded] = useState(cachedPref != null && cachedExplained != null);
  const [explained, setExplained] = useState(cachedExplained ?? true);
  const [detectorAvailable, setDetectorAvailable] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [probeStats, setProbeStats] = useState<GradeProbeStats>({ allFoundAtMs: null, hitStreak: 0, missStreak: 0, errorStreak: 0 });
  const [view, setView] = useState<{ phase: GradeAutoPhase; progress: number; hint: string }>({
    phase: "searching",
    progress: 0,
    hint: "",
  });
  const stateRef = useRef(GRADE_AUTO_INITIAL);
  const statsRef = useRef<GradeProbeStats>({ allFoundAtMs: null, hitStreak: 0, missStreak: 0, errorStreak: 0 });
  const hintRef = useRef<StableHint | null>(null);
  const loopRef = useRef<GradeProbeLoop | null>(null);
  const latest = useRef({ level, busy, onFire: input.onFire, frameFill: input.frameFill });
  useEffect(() => {
    latest.current = { level, busy, onFire: input.onFire, frameFill: input.frameFill };
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [pref, seen] = await Promise.all([readFlag(PREF_KEY), readFlag(EXPLAINER_KEY)]);
      cachedPref = cachedPref ?? (pref == null ? GRADE_AUTO_TOGGLE_DEFAULT : pref === "1");
      cachedExplained = cachedExplained ?? seen === "1";
      if (cancelled) return;
      setEnabledState(cachedPref);
      setExplained(cachedExplained);
      setPrefLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mobile Tech Lead review 5: the loop is torn down when the app leaves the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => setAppActive(next === "active"));
    return () => sub.remove();
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    cachedPref = on;
    writeFlag(PREF_KEY, on ? "1" : "0");
    setEnabledState(on);
  }, []);

  const showExplainer = prefLoaded && enabled && !explained && active;
  const dismissExplainer = useCallback(() => {
    cachedExplained = true;
    writeFlag(EXPLAINER_KEY, "1");
    setExplained(true);
  }, []);

  const probing =
    active &&
    appActive &&
    prefLoaded &&
    enabled &&
    explained &&
    level.available &&
    detectorAvailable &&
    probeSizeAvailable &&
    layoutReady;

  useEffect(() => {
    if (!probing) return;
    const loop = createGradeProbeLoop({
      canProbe: () => {
        const { level: lv, busy: isBusy } = latest.current;
        const pose = lv.level === "level" || lv.level === "near";
        return !isBusy && pose && lv.steady !== false && cameraRef.current != null;
      },
      probe: async () => {
        const shot = await cameraRef.current?.takePictureAsync({ quality: 0.1, shutterSound: false, exif: false });
        if (!shot?.uri) return null;
        const fill = latest.current.frameFill(shot.width, shot.height);
        if (fill == null) return null;
        return probeGradeCorners(shot.uri, fill);
      },
      onResult: (stats) => {
        statsRef.current = stats;
        setProbeStats(stats);
      },
      onUnavailable: () => setDetectorAvailable(false),
    });
    loop.start();
    loopRef.current = loop;
    return () => {
      loop.stop();
      if (loopRef.current === loop) loopRef.current = null;
      statsRef.current = { ...loop.stats(), allFoundAtMs: null, hitStreak: 0 };
      setProbeStats(statsRef.current);
    };
  }, [probing, cameraRef]);

  // One state-machine tick per sensor update (~100 ms) and per probe result.
  useEffect(() => {
    const c = statsRef.current;
    const step = gradeAutoCaptureStep(stateRef.current, {
      enabled: enabled && explained,
      sensorAvailable: level.available,
      motionDenied: level.permission === "denied",
      detectorAvailable: detectorAvailable && probeSizeAvailable,
      cornersAllFoundAtMs: c.allFoundAtMs,
      cornerHitStreak: c.hitStreak,
      cornerMissStreak: c.missStreak,
      level: level.level,
      steady: level.steady,
      busy: busy || !active || !appActive,
      nowMs: Date.now(),
    });
    stateRef.current = step.state;
    hintRef.current = gradeStableHint(hintRef.current, gradeAutoHint(step), Date.now());
    const hint = hintRef.current.shown;
    setView((prev) =>
      prev.phase === step.state.phase && prev.progress === step.progress && prev.hint === hint
        ? prev
        : { phase: step.state.phase, progress: step.progress, hint },
    );
    if (step.fire) latest.current.onFire();
  }, [level, busy, enabled, explained, detectorAvailable, probeSizeAvailable, active, appActive, probeStats]);

  const waitForProbe = useCallback(async () => {
    await loopRef.current?.waitForIdle();
  }, []);

  const noteCapture = useCallback(() => {
    stateRef.current = gradeAutoNoteCapture(stateRef.current, Date.now());
    loopRef.current?.resetCorners();
    statsRef.current = { ...statsRef.current, allFoundAtMs: null, hitStreak: 0, missStreak: 0 };
    setProbeStats(statsRef.current);
  }, []);

  // Fresh-ness is re-checked on every sensor tick (the level object changes ~every 100 ms).
  const cardInFrame =
    probeStats.hitStreak >= GRADE_AUTO_CORNER_HITS_REQUIRED && probeStats.allFoundAtMs != null && level.available
      ? true
      : probeStats.missStreak >= GRADE_AUTO_CORNER_MISS_CANCEL
        ? false
        : null;

  return {
    enabled,
    prefLoaded,
    setEnabled,
    showExplainer,
    dismissExplainer,
    phase: view.phase,
    progress: view.progress,
    hint: view.hint,
    cardInFrame,
    probing,
    waitForProbe,
    noteCapture,
  };
}
