import { describe, expect, it } from "vitest";
import {
  featureDisabledBody,
  livestreamEnabledFromEnv,
  livestreamEnabledFromStatus,
  trendingEnabledFromEnv,
  trendingEnabledFromStatus,
} from "./livestream-kill-switch";
import { TRENDING_DISABLED_COPY } from "./trending";

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

describe("trending kill switch", () => {
  it("defaults off and only turns on on explicit values", () => {
    expect(trendingEnabledFromEnv(undefined)).toBe(false);
    expect(trendingEnabledFromEnv("")).toBe(false);
    expect(trendingEnabledFromEnv("0")).toBe(false);
    expect(trendingEnabledFromEnv("false")).toBe(false);
    for (const on of ["1", "true", "ON", " yes "]) expect(trendingEnabledFromEnv(on)).toBe(true);
  });
  it("reads the status payload, treating missing features as off", () => {
    expect(trendingEnabledFromStatus(undefined)).toBe(false);
    expect(trendingEnabledFromStatus({})).toBe(false);
    expect(trendingEnabledFromStatus({ features: { trending: true } })).toBe(true);
    expect(trendingEnabledFromStatus({ features: { trending: false } })).toBe(false);
  });
  it("uses the agreed copy", () => {
    expect(featureDisabledBody("trending")).toEqual({
      ok: false,
      code: "feature_disabled",
      feature: "trending",
      error: TRENDING_DISABLED_COPY,
      userFacing: true,
    });
  });
});
