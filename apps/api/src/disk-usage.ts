import { statfsSync } from "node:fs";
import type { OpsMetrics } from "./ops-metrics";

/** Dev Ops (Oct 19): check the data volume's fill level and raise ops alerts at 70% / 85%. */
export const DISK_USAGE_INTERVAL_MS = 15 * 60_000;

export function readDiskUsage(dir: string): { usedBytes: number; totalBytes: number } | null {
  try {
    const s = statfsSync(dir);
    const totalBytes = Number(s.blocks) * Number(s.bsize);
    const freeBytes = Number(s.bavail) * Number(s.bsize);
    if (!(totalBytes > 0)) return null;
    return { usedBytes: totalBytes - freeBytes, totalBytes };
  } catch {
    return null;
  }
}

export function startDiskUsageMonitor(options: {
  dir: string;
  metrics: Pick<OpsMetrics, "recordDiskUsage">;
  read?: (dir: string) => { usedBytes: number; totalBytes: number } | null;
  intervalMs?: number;
}): { stop: () => void; runOnce: () => void } {
  const read = options.read ?? readDiskUsage;
  function runOnce() {
    const usage = read(options.dir);
    if (usage) options.metrics.recordDiskUsage(usage.usedBytes, usage.totalBytes);
  }
  runOnce();
  const timer = setInterval(runOnce, options.intervalMs ?? DISK_USAGE_INTERVAL_MS);
  timer.unref?.();
  return { stop: () => clearInterval(timer), runOnce };
}
