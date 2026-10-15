import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deviceClassFor, isHot, parsePerfBatch } from "./perf-telemetry";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("perf telemetry (P1-18)", () => {
  it("buckets device class", () => {
    expect(deviceClassFor({})).toBe("unknown");
    expect(deviceClassFor({ yearClass: 2023 })).toBe("high");
    expect(deviceClassFor({ yearClass: 2020 })).toBe("mid");
    expect(deviceClassFor({ yearClass: 2016, totalMemoryBytes: 2 * 1024 ** 3 })).toBe("low");
  });

  it("keeps only timing fields", () => {
    const batch = parsePerfBatch({
      deviceClass: "x",
      os: "ios",
      thermal: "critical",
      photo: "data:image/jpeg;base64,AAAA",
      samples: [{ stage: "live_detect", ms: 12.4, uri: "file://x" }, { stage: "nope", ms: 1 }, { stage: "live_detect", ms: -1 }],
    });
    expect(batch).toEqual({ deviceClass: "unknown", deviceModel: null, os: "ios", thermal: "critical", samples: [{ stage: "live_detect", ms: 12 }] });
    expect(isHot("critical")).toBe(true);
    expect(parsePerfBatch(null)).toBeNull();
  });

  it("phone code never sends images in telemetry", () => {
    const src = readFileSync(path.join(REPO, "apps/mobile/lib/perf-telemetry.ts"), "utf8");
    expect(src).not.toMatch(/\buri\b|[Jj]peg|base64|imageUri|frame\./);
  });
});
