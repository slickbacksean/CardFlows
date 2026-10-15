import * as Device from "expo-device";
import { Platform } from "react-native";
import {
  PERF_BATCH_MAX,
  PERF_SAMPLE_RATE,
  deviceClassFor,
  type PerfBatch,
  type PerfSample,
  type PerfStage,
} from "@cardflow/shared";
import { postPerfTelemetry } from "./api";

/**
 * P1-18: sampled on-device stage timings. Only numbers, a bucketed device class and the model
 * name leave the phone; never images or card data. Expo Go exposes no thermal API, so thermal is
 * "unknown" until a dev build adds one.
 */
const FLUSH_MS = 30_000;
let buffer: PerfSample[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function osName(): PerfBatch["os"] {
  return Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web" ? Platform.OS : "other";
}

export function recordPerfStage(stage: PerfStage, ms: number, random: () => number = Math.random): void {
  if (!Number.isFinite(ms) || ms < 0 || random() >= PERF_SAMPLE_RATE) return;
  buffer.push({ stage, ms });
  if (buffer.length >= PERF_BATCH_MAX) void flushPerfTelemetry();
  else if (!timer) timer = setTimeout(() => void flushPerfTelemetry(), FLUSH_MS);
}

/** Times an async step and records it (sampled). */
export async function timePerfStage<T>(stage: PerfStage, run: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await run();
  } finally {
    recordPerfStage(stage, Date.now() - start);
  }
}

export async function flushPerfTelemetry(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (buffer.length === 0) return;
  const samples = buffer.splice(0, PERF_BATCH_MAX);
  try {
    await postPerfTelemetry({
      deviceClass: deviceClassFor({ yearClass: Device.deviceYearClass, totalMemoryBytes: Device.totalMemory }),
      deviceModel: Device.modelName ?? null,
      os: osName(),
      thermal: "unknown",
      samples,
    });
  } catch {
    // Telemetry is best effort; drop on failure rather than retry.
  }
}
