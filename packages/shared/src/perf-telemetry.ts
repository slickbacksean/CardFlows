/**
 * P1-18: on-device performance telemetry. Timings only: no images, no card data, no user text.
 */
export const PERF_STAGES = [
  "grade_still_prep",
  "scan_still_prep",
  "live_frame_pull",
  "live_detect",
  "live_identify_round_trip",
  "live_frame_to_hud",
  "live_card_to_result_in_house",
  "live_card_to_result_cardsight",
  "live_card_to_result_over_budget",
] as const;
export type PerfStage = (typeof PERF_STAGES)[number];

export type DeviceClass = "low" | "mid" | "high" | "unknown";
export type ThermalState = "nominal" | "fair" | "serious" | "critical" | "unknown";

export interface PerfSample {
  stage: PerfStage;
  ms: number;
}

export interface PerfBatch {
  deviceClass: DeviceClass;
  deviceModel: string | null;
  os: "ios" | "android" | "web" | "other";
  thermal: ThermalState;
  samples: PerfSample[];
}

/** Share of timings sent; the rest are dropped on the phone. */
export const PERF_SAMPLE_RATE = 0.2;
export const PERF_BATCH_MAX = 50;
const MAX_MS = 120_000;

/** Device year class (expo-device) plus RAM, bucketed so nothing identifies a device. */
export function deviceClassFor(input: { yearClass?: number | null; totalMemoryBytes?: number | null }): DeviceClass {
  const year = input.yearClass ?? null;
  const gb = input.totalMemoryBytes ? input.totalMemoryBytes / 1024 ** 3 : null;
  if (year == null && gb == null) return "unknown";
  if ((year != null && year >= 2022) || (gb != null && gb >= 7.5)) return "high";
  if ((year != null && year >= 2019) || (gb != null && gb >= 3.5)) return "mid";
  return "low";
}

export function isHot(thermal: ThermalState): boolean {
  return thermal === "serious" || thermal === "critical";
}

const DEVICE_CLASSES = new Set<DeviceClass>(["low", "mid", "high", "unknown"]);
const THERMAL = new Set<ThermalState>(["nominal", "fair", "serious", "critical", "unknown"]);
const OS = new Set(["ios", "android", "web", "other"]);
const STAGES = new Set<string>(PERF_STAGES);

/** Server-side validation: keeps only known fields; anything else (like image data) is dropped. */
export function parsePerfBatch(value: unknown): PerfBatch | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.samples)) return null;
  const samples: PerfSample[] = [];
  for (const raw of v.samples.slice(0, PERF_BATCH_MAX)) {
    const s = raw as Record<string, unknown>;
    if (typeof s?.stage !== "string" || !STAGES.has(s.stage)) continue;
    if (typeof s.ms !== "number" || !Number.isFinite(s.ms) || s.ms < 0 || s.ms > MAX_MS) continue;
    samples.push({ stage: s.stage as PerfStage, ms: Math.round(s.ms) });
  }
  const model = typeof v.deviceModel === "string" ? v.deviceModel.slice(0, 64) : null;
  return {
    deviceClass: DEVICE_CLASSES.has(v.deviceClass as DeviceClass) ? (v.deviceClass as DeviceClass) : "unknown",
    deviceModel: model,
    os: OS.has(v.os as string) ? (v.os as PerfBatch["os"]) : "other",
    thermal: THERMAL.has(v.thermal as ThermalState) ? (v.thermal as ThermalState) : "unknown",
    samples,
  };
}
