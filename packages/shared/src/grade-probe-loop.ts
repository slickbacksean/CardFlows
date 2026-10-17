/**
 * Grade auto-capture corner-probe loop, framework-free so it can be tested
 * with fake timers (Mobile Tech Lead review 9). The app hook supplies the
 * camera call; this owns the throttle, the hung-probe timeout, the
 * no-overlap rule and teardown.
 */
import {
  GRADE_AUTO_CORNERS_REQUIRED,
  GRADE_AUTO_PROBE_MAX_ERRORS,
  GRADE_AUTO_PROBE_TIMEOUT_MS,
  GRADE_AUTO_PROBE_WAIT_MAX_MS,
  gradeProbeIntervalMs,
} from "./grade-auto-capture";

export interface GradeProbeStats {
  /** When the photo of the latest 4-corner probe was taken. */
  allFoundAtMs: number | null;
  hitStreak: number;
  missStreak: number;
  errorStreak: number;
}

export interface GradeProbeLoopDeps {
  /** Take a small probe photo and count corners (0-4), or null on failure. */
  probe: () => Promise<number | null>;
  /** Pose, layout and busy pre-check; false skips this round without touching the camera. */
  canProbe: () => boolean;
  /** After every finished probe (never after stop()). */
  onResult: (stats: GradeProbeStats) => void;
  /** After GRADE_AUTO_PROBE_MAX_ERRORS failures in a row; the loop stops itself. */
  onUnavailable: () => void;
  now?: () => number;
}

export interface GradeProbeLoop {
  start: () => void;
  /** Cancel timers; a probe in flight is ignored when it settles. */
  stop: () => void;
  running: () => boolean;
  /** A camera call (possibly hung) hasn't settled yet. */
  cameraBusy: () => boolean;
  /** Resolves when the probe in flight settles, or after maxMs at most. */
  waitForIdle: (maxMs?: number) => Promise<void>;
  stats: () => GradeProbeStats;
  /** Any capture resets the corner streaks (a new pose must be found again). */
  resetCorners: () => void;
}

const EMPTY: GradeProbeStats = { allFoundAtMs: null, hitStreak: 0, missStreak: 0, errorStreak: 0 };

export function createGradeProbeLoop(deps: GradeProbeLoopDeps): GradeProbeLoop {
  const now = deps.now ?? (() => Date.now());
  let stats: GradeProbeStats = { ...EMPTY };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let isRunning = false;
  /** The raw camera call; stays set while a hung call is still pending. */
  let camera: Promise<unknown> | null = null;
  /** The current round (camera call or its timeout). */
  let round: Promise<void> | null = null;

  const schedule = (gen: number) => {
    if (gen !== generation || !isRunning) return;
    timer = setTimeout(() => void tick(gen), gradeProbeIntervalMs(stats.missStreak));
  };

  const recordError = (gen: number) => {
    stats = { ...stats, errorStreak: stats.errorStreak + 1 };
    if (stats.errorStreak >= GRADE_AUTO_PROBE_MAX_ERRORS) {
      isRunning = false;
      if (gen === generation) deps.onUnavailable();
      return true;
    }
    return false;
  };

  const tick = async (gen: number) => {
    timer = null;
    if (gen !== generation || !isRunning) return;
    if (camera) {
      // The last camera call never settled: never stack another on top of it.
      if (recordError(gen)) return;
      deps.onResult(stats);
      schedule(gen);
      return;
    }
    if (!deps.canProbe()) {
      schedule(gen);
      return;
    }
    const startedAtMs = now();
    const call = deps.probe().catch(() => null);
    camera = call;
    void call.finally(() => {
      if (camera === call) camera = null;
    });
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const current = (async () => {
      const found = await Promise.race([
        call,
        new Promise<"timeout">((resolve) => {
          timeout = setTimeout(() => resolve("timeout"), GRADE_AUTO_PROBE_TIMEOUT_MS);
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      if (gen !== generation) return; // stopped meanwhile: ignore the result
      if (found === "timeout" || found == null) {
        if (recordError(gen)) return;
      } else if (found >= GRADE_AUTO_CORNERS_REQUIRED) {
        stats = { allFoundAtMs: startedAtMs, hitStreak: stats.hitStreak + 1, missStreak: 0, errorStreak: 0 };
      } else {
        stats = { ...stats, hitStreak: 0, missStreak: stats.missStreak + 1, errorStreak: 0 };
      }
      deps.onResult(stats);
      schedule(gen);
    })();
    round = current;
    await current;
    if (round === current) round = null;
  };

  return {
    start() {
      if (isRunning) return;
      isRunning = true;
      generation += 1;
      schedule(generation);
    },
    stop() {
      isRunning = false;
      generation += 1;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    running: () => isRunning,
    cameraBusy: () => camera != null,
    async waitForIdle(maxMs = GRADE_AUTO_PROBE_WAIT_MAX_MS) {
      const pending = camera;
      if (!pending) return;
      let t: ReturnType<typeof setTimeout> | null = null;
      await Promise.race([
        pending.then(
          () => undefined,
          () => undefined,
        ),
        new Promise<void>((resolve) => {
          t = setTimeout(resolve, maxMs);
        }),
      ]);
      if (t) clearTimeout(t);
    },
    stats: () => stats,
    resetCorners() {
      stats = { ...EMPTY, errorStreak: stats.errorStreak };
    },
  };
}
