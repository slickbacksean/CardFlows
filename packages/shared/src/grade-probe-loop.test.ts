import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GRADE_AUTO_PROBE_BACKOFF_MS,
  GRADE_AUTO_PROBE_INTERVAL_MS,
  GRADE_AUTO_PROBE_MAX_ERRORS,
  GRADE_AUTO_PROBE_TIMEOUT_MS,
  GRADE_AUTO_PROBE_WAIT_MAX_MS,
} from "./grade-auto-capture";
import { createGradeProbeLoop, type GradeProbeStats } from "./grade-probe-loop";

/** Mobile Tech Lead review 9: the probe loop under fake timers. */
function setup(opts: { probe?: () => Promise<number | null>; canProbe?: () => boolean } = {}) {
  const results: GradeProbeStats[] = [];
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const unavailable = vi.fn();
  const loop = createGradeProbeLoop({
    probe: async () => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await (opts.probe ?? (async () => 4))();
      } finally {
        inFlight -= 1;
      }
    },
    canProbe: opts.canProbe ?? (() => true),
    onResult: (stats) => results.push(stats),
    onUnavailable: unavailable,
  });
  return { loop, results, unavailable, calls: () => calls, maxInFlight: () => maxInFlight };
}

describe("grade probe loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles to one probe per 1.5 s and stamps hits with the photo time", async () => {
    const t = setup();
    t.loop.start();
    await vi.advanceTimersByTimeAsync(GRADE_AUTO_PROBE_INTERVAL_MS - 1);
    expect(t.calls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(GRADE_AUTO_PROBE_INTERVAL_MS);
    expect(t.calls()).toBe(2);
    expect(t.results.at(-1)).toMatchObject({ hitStreak: 2, missStreak: 0, allFoundAtMs: 2 * GRADE_AUTO_PROBE_INTERVAL_MS });
    t.loop.stop();
  });

  it("backs off after repeated misses", async () => {
    const t = setup({ probe: async () => 1 });
    t.loop.start();
    await vi.advanceTimersByTimeAsync(GRADE_AUTO_PROBE_INTERVAL_MS * 5);
    expect(t.calls()).toBe(5);
    await vi.advanceTimersByTimeAsync(GRADE_AUTO_PROBE_INTERVAL_MS);
    expect(t.calls()).toBe(5); // now every 3 s
    await vi.advanceTimersByTimeAsync(GRADE_AUTO_PROBE_BACKOFF_MS - GRADE_AUTO_PROBE_INTERVAL_MS);
    expect(t.calls()).toBe(6);
    t.loop.stop();
  });

  it("skips the camera entirely when the pre-check fails (tilted, moving, busy, not measured)", async () => {
    const t = setup({ canProbe: () => false });
    t.loop.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.calls()).toBe(0);
    t.loop.stop();
  });

  it("cleanup: stop() clears the timer and ignores a probe that settles afterwards", async () => {
    let resolve: (n: number) => void = () => {};
    const t = setup({ probe: () => new Promise<number>((r) => (resolve = r)) });
    t.loop.start();
    await vi.advanceTimersByTimeAsync(GRADE_AUTO_PROBE_INTERVAL_MS);
    expect(t.calls()).toBe(1);
    t.loop.stop();
    resolve(4);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.results).toEqual([]);
    expect(t.calls()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("focus loss / background: stop then start resumes without stacking timers", async () => {
    const t = setup();
    t.loop.start();
    t.loop.stop();
    t.loop.start();
    t.loop.start(); // idempotent
    await vi.advanceTimersByTimeAsync(GRADE_AUTO_PROBE_INTERVAL_MS);
    expect(t.calls()).toBe(1);
    t.loop.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.calls()).toBe(1);
  });

  it("overlap: never two camera calls at once, even when a probe is slower than the interval", async () => {
    const t = setup({ probe: () => new Promise<number>((r) => setTimeout(() => r(4), 2_000)) });
    t.loop.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.calls()).toBeGreaterThan(2);
    expect(t.maxInFlight()).toBe(1);
    t.loop.stop();
  });

  it("hung probe: times out as an error, never stacks a second call, and goes manual after 3", async () => {
    const t = setup({ probe: () => new Promise<number>(() => {}) });
    t.loop.start();
    await vi.advanceTimersByTimeAsync(GRADE_AUTO_PROBE_INTERVAL_MS + GRADE_AUTO_PROBE_TIMEOUT_MS);
    expect(t.results.at(-1)?.errorStreak).toBe(1);
    expect(t.loop.cameraBusy()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.calls()).toBe(1); // the hung call is never stacked
    expect(GRADE_AUTO_PROBE_MAX_ERRORS).toBe(3);
    expect(t.unavailable).toHaveBeenCalledTimes(1);
    expect(t.loop.running()).toBe(false);
  });

  it("waitForIdle: the real shot waits for a probe in flight, but 1.5 s at most", async () => {
    const t = setup({ probe: () => new Promise<number>(() => {}) });
    t.loop.start();
    await vi.advanceTimersByTimeAsync(GRADE_AUTO_PROBE_INTERVAL_MS);
    let done = false;
    void t.loop.waitForIdle().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(GRADE_AUTO_PROBE_WAIT_MAX_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    t.loop.stop();
    // Nothing in flight: resolves at once.
    const idle = setup();
    let quick = false;
    void idle.loop.waitForIdle().then(() => (quick = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(quick).toBe(true);
  });

  it("resetCorners: a capture clears the hit streak", async () => {
    const t = setup();
    t.loop.start();
    await vi.advanceTimersByTimeAsync(GRADE_AUTO_PROBE_INTERVAL_MS * 2);
    expect(t.loop.stats().hitStreak).toBe(2);
    t.loop.resetCorners();
    expect(t.loop.stats()).toMatchObject({ hitStreak: 0, allFoundAtMs: null });
    t.loop.stop();
  });
});
