import { describe, expect, it } from "vitest";
import { gradeJobPollDelayMs, gradeJobWaitCopy, pollGradeJob, type GradeJobView } from "./grade-jobs";

const job = (status: GradeJobView["status"], retryAfterSeconds: number | null = null): GradeJobView => ({
  jobId: "j", status, retryAfterSeconds, estimate: null, error: null, requestId: null,
});

describe("P1-07 grade job polling", () => {
  it("backs off and honors a server wait hint", () => {
    expect(gradeJobPollDelayMs(0)).toBe(1000);
    expect(gradeJobPollDelayMs(1)).toBe(1500);
    expect(gradeJobPollDelayMs(20)).toBe(8000);
    expect(gradeJobPollDelayMs(0, 12)).toBe(12000);
  });
  it("keeps polling through network errors and stops when done", async () => {
    const answers: Array<GradeJobView | Error> = [job("queued"), new Error("offline"), job("waiting", 3), job("done")];
    const seen: string[] = [];
    const result = await pollGradeJob(async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    }, { sleep: async () => {}, onUpdate: (j) => seen.push(j.status) });
    expect(result?.status).toBe("done");
    expect(seen).toEqual(["queued", "waiting", "done"]);
  });
  it("times out to null and the wait copy shows a time", async () => {
    let t = 0;
    const result = await pollGradeJob(async () => job("running"), { sleep: async (ms) => { t += ms; }, now: () => t, timeoutMs: 5000 });
    expect(result).toBeNull();
    expect(gradeJobWaitCopy(12)).toBe("Busy right now. Your pre-grade estimate starts in about 12 s.");
    expect(gradeJobWaitCopy(null)).not.toMatch(/\bAI\b|PSA|BGS|CGC/);
  });
});
