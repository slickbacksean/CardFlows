import { describe, expect, it } from "vitest";
import { featureDisabledBody, livestreamEnabledFromEnv, livestreamEnabledFromStatus } from "./livestream-kill-switch";

describe("livestream kill switch", () => {
  it("defaults on and only turns off on explicit values", () => {
    expect(livestreamEnabledFromEnv(undefined)).toBe(true);
    expect(livestreamEnabledFromEnv("")).toBe(true);
    expect(livestreamEnabledFromEnv("true")).toBe(true);
    for (const off of ["0", "false", "OFF", " no "]) expect(livestreamEnabledFromEnv(off)).toBe(false);
  });
  it("reads the status payload, treating missing features as on", () => {
    expect(livestreamEnabledFromStatus(undefined)).toBe(true);
    expect(livestreamEnabledFromStatus({})).toBe(true);
    expect(livestreamEnabledFromStatus({ features: { livestream: true } })).toBe(true);
    expect(livestreamEnabledFromStatus({ features: { livestream: false } })).toBe(false);
  });
  it("uses the agreed copy", () => {
    expect(featureDisabledBody("livestream")).toEqual({ ok: false, code: "feature_disabled", feature: "livestream", error: "Live Scan is temporarily unavailable.", userFacing: true });
  });
});
