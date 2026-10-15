import { describe, expect, it } from "vitest";
import {
  gradeJobPollDelayMs,
  gradeJobWaitAnnouncement,
  gradeJobWaitCopy,
  pollGradeJob,
  type GradeJobView,
  EMPTY_GRADE_WAIT_CLOCK,
  waitClockOnJob,
  waitClockOnPollError,
  waitSecondsLeft,
} from "./grade-jobs";
import { GRADE_ESTIMATE_UNAVAILABLE_COPY } from "./grade-estimate";

const job = (status: GradeJobView["status"], retryAfterSeconds: number | null = null): GradeJobView => ({
  jobId: "j", status, retryAfterSeconds, estimate: null, error: null, requestId: null,
});
const noSleep = async () => {};

describe("P1-07 grade job polling", () => {
  it("backs off and honors a server wait hint", () => {
    expect(gradeJobPollDelayMs(0)).toBe(1000);
    expect(gradeJobPollDelayMs(1)).toBe(1500);
    expect(gradeJobPollDelayMs(20)).toBe(8000);
    expect(gradeJobPollDelayMs(0, 12)).toBe(12000);
  });

  it("keeps polling through network errors, reports them, and stops when done", async () => {
    const answers: Array<GradeJobView | Error> = [job("queued"), new Error("offline"), new Error("offline"), job("waiting", 3), job("done")];
    const seen: string[] = [];
    const failures: number[] = [];
    const result = await pollGradeJob(async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    }, { sleep: noSleep, onUpdate: (j) => seen.push(j.status), onPollError: (n) => failures.push(n) });
    expect(result).toMatchObject({ kind: "finished", job: { status: "done" } });
    expect(seen).toEqual(["queued", "waiting", "done"]);
    expect(failures).toEqual([1, 2]);
  });

  it("returns not_found on a 404, aborted on Cancel, timeout otherwise", async () => {
    const notFound = await pollGradeJob(async () => { throw Object.assign(new Error("nf"), { status: 404 }); }, {
      sleep: noSleep,
      isNotFound: (e) => (e as { status?: number }).status === 404,
    });
    expect(notFound).toEqual({ kind: "not_found" });

    const controller = new AbortController();
    let calls = 0;
    const aborted = await pollGradeJob(async () => {
      calls += 1;
      if (calls === 2) controller.abort();
      return job("running");
    }, { sleep: noSleep, signal: controller.signal });
    expect(aborted).toEqual({ kind: "aborted" });

    let t = 0;
    const timeout = await pollGradeJob(async () => job("running"), { sleep: async (ms) => { t += ms; }, now: () => t, timeoutMs: 5000 });
    expect(timeout).toEqual({ kind: "timeout" });
  });

  it("wait copy: about N seconds, about N min rounded up, Starting soon at 0, never 0 s", () => {
    expect(gradeJobWaitCopy(12)).toBe("Busy right now. Your pre-grade estimate starts in about 12 seconds.");
    expect(gradeJobWaitCopy(1)).toBe("Busy right now. Your pre-grade estimate starts in about 1 second.");
    expect(gradeJobWaitCopy(60)).toBe("Busy right now. Your pre-grade estimate starts in about 60 seconds.");
    expect(gradeJobWaitCopy(61)).toBe("Busy right now. Your pre-grade estimate starts in about 2 min.");
    expect(gradeJobWaitCopy(125)).toBe("Busy right now. Your pre-grade estimate starts in about 3 min.");
    expect(gradeJobWaitCopy(0)).toBe("Starting soon…");
    expect(gradeJobWaitCopy(-4)).toBe("Starting soon…");
    expect(gradeJobWaitCopy(null)).toBe("Waiting for a pre-grade slot…");
    expect(gradeJobWaitAnnouncement(125)).toBe("Busy right now. Your pre-grade estimate starts in about 3 minutes.");
    for (const n of [0, 0.4, 1, 59, 61, 3600]) {
      expect(gradeJobWaitCopy(n)).not.toMatch(/\b0 s\b|\bAI\b|PSA|BGS|CGC|grade\b(?! estimate)/);
    }
  });

  it("failure copy is the approved sentence", () => {
    expect(GRADE_ESTIMATE_UNAVAILABLE_COPY).toBe("Pre-grade estimate unavailable. Try again later.");
  });

  it("wait clock only counts down within a wait, resets on a later deadline, freezes offline", () => {
    let c = waitClockOnJob(EMPTY_GRADE_WAIT_CLOCK, job("waiting", 20), 0);
    expect(waitSecondsLeft(c.deadline!, 5_000)).toBe(15);
    c = waitClockOnJob(c, job("waiting", 16), 5_000); // poll repeats a similar hint: keep counting
    expect(waitSecondsLeft(c.deadline!, 6_000)).toBe(14);
    c = waitClockOnJob(c, job("waiting", 30), 6_000); // server re-waited: new wait
    expect(waitSecondsLeft(c.deadline!, 6_000)).toBe(30);
    c = waitClockOnPollError(c, 1, 7_000);
    expect(c.frozenSeconds).toBeNull();
    c = waitClockOnPollError(c, 2, 8_000);
    expect(c.frozenSeconds).toBe(28);
    expect(waitClockOnPollError(c, 3, 20_000).frozenSeconds).toBe(28);
    expect(waitSecondsLeft(c.deadline!, 99_000)).toBe(0);
    expect(waitClockOnJob(c, job("running"), 9_000)).toMatchObject({ deadline: null, failures: 0, frozenSeconds: null });
  });
});
