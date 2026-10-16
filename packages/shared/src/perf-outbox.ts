/**
 * Sean's decision: perf timings (`/v1/telemetry/perf`) follow the same analytics switch as
 * PostHog. When the switch is off nothing is buffered or sent, and pending timings are dropped.
 */
import type { PerfSample } from "./perf-telemetry";

export interface PerfOutbox {
  record(sample: PerfSample): number;
  /** Takes up to `max` samples to send, or none (and clears) if analytics is off. */
  take(max: number): PerfSample[];
  clear(): void;
  size(): number;
}

export function createPerfOutbox(isEnabled: () => boolean): PerfOutbox {
  let buffer: PerfSample[] = [];
  return {
    record(sample) {
      if (!isEnabled()) {
        buffer = [];
        return 0;
      }
      buffer.push(sample);
      return buffer.length;
    },
    take(max) {
      if (!isEnabled()) {
        buffer = [];
        return [];
      }
      return buffer.splice(0, max);
    },
    clear() {
      buffer = [];
    },
    size() {
      return buffer.length;
    },
  };
}
