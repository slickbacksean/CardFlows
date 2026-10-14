import { describe, expect, it } from "vitest";
import { createCardgradingEngineProbe } from "./cardgrading-run";

describe("createCardgradingEngineProbe", () => {
  it("does not cache a failed probe so /health can recover", async () => {
    let calls = 0;
    const probe = createCardgradingEngineProbe("python", Date.now, async () => {
      calls += 1;
      if (calls === 1) throw new Error("cv2 missing");
      return { opencv: "4.10.0", numpy: "2.2.0" };
    });
    const first = await probe();
    expect(first.ok).toBe(false);
    expect(first.error).toMatch(/cv2 missing/);
    const second = await probe();
    expect(second.ok).toBe(true);
    expect(second.opencv).toBe("4.10.0");
    expect(second).not.toBe(first);
    expect(calls).toBe(2);
  });

  it("caches a successful probe", async () => {
    let calls = 0;
    const probe = createCardgradingEngineProbe("python", Date.now, async () => {
      calls += 1;
      return { opencv: "4.10.0", numpy: "2.2.0" };
    });
    const first = await probe();
    const second = await probe();
    expect(first.ok).toBe(true);
    expect(second).toBe(first);
    expect(calls).toBe(1);
  });

  it("reports not ok when the grader Python can't start", async () => {
    const probe = createCardgradingEngineProbe("/nonexistent/python-for-cardflow");
    const status = await probe();
    expect(status.ok).toBe(false);
    expect(status.opencv).toBeNull();
    const again = await probe();
    expect(again.ok).toBe(false);
    expect(again).not.toBe(status);
  });
});
