import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPerfOutbox } from "./perf-outbox";

describe("perf timings follow the analytics switch", () => {
  it("buffers and sends nothing while analytics is off", () => {
    const outbox = createPerfOutbox(() => false);
    expect(outbox.record({ stage: "recognition", ms: 120 } as never)).toBe(0);
    expect(outbox.take(50)).toEqual([]);
    expect(outbox.size()).toBe(0);
  });
  it("drops pending timings when analytics is turned off", () => {
    let on = true;
    const outbox = createPerfOutbox(() => on);
    outbox.record({ stage: "recognition", ms: 120 } as never);
    outbox.record({ stage: "recognition", ms: 90 } as never);
    expect(outbox.size()).toBe(2);
    on = false;
    expect(outbox.take(50)).toEqual([]);
    expect(outbox.size()).toBe(0);
    on = true;
    expect(outbox.take(50)).toEqual([]);
  });
  it("the mobile client gates /v1/telemetry/perf on the analytics switch", () => {
    const lib = readFileSync(resolve(__dirname, "../../../apps/mobile/lib/perf-telemetry.ts"), "utf8");
    expect(lib).toContain("createPerfOutbox(isAnalyticsEnabled)");
    expect(lib).toContain("onAnalyticsDisabled(");
    expect(lib).toMatch(/if \(!isAnalyticsEnabled\(\)\) return;/);
    const events = readFileSync(resolve(__dirname, "../../../apps/mobile/lib/product-events.ts"), "utf8");
    expect(events).toContain("for (const listener of disabledListeners) listener();");
  });
});
