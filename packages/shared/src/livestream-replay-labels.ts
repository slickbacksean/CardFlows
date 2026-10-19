/**
 * Label format for the livestream replay harness (Sean's clips).
 * One JSONL line per card appearance (or a no-card segment).
 * Times are seconds from the start of the video file.
 */

export interface LivestreamReplayLabel {
  /** Start time in seconds (inclusive). */
  startSec: number;
  /** End time in seconds (exclusive). */
  endSec: number;
  /** Catalog id when a card is visible; null for no-card segments. */
  tcgdexId: string | null;
  /** Optional set code (e.g. base1). */
  set?: string | null;
  /** Optional collector number. */
  number?: string | null;
  /** Optional variant note (holo, reverse, etc.). */
  variant?: string | null;
  /** Card held steady long enough to identify. */
  steady?: boolean;
  notes?: string | null;
}

export function parseLivestreamReplayLabelsJsonl(raw: string): LivestreamReplayLabel[] {
  const labels: LivestreamReplayLabel[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const value = JSON.parse(trimmed) as Partial<LivestreamReplayLabel>;
    if (typeof value.startSec !== "number" || typeof value.endSec !== "number") {
      throw new Error(`Invalid label line (need startSec/endSec): ${trimmed.slice(0, 80)}`);
    }
    if (value.endSec <= value.startSec) {
      throw new Error(`Label endSec must be > startSec: ${trimmed.slice(0, 80)}`);
    }
    labels.push({
      startSec: value.startSec,
      endSec: value.endSec,
      tcgdexId: typeof value.tcgdexId === "string" ? value.tcgdexId : null,
      set: value.set ?? null,
      number: value.number ?? null,
      variant: value.variant ?? null,
      steady: value.steady === true,
      notes: value.notes ?? null,
    });
  }
  return labels;
}

/** Expected id at a given timestamp, or null during a no-card / unlabeled stretch. */
export function labelAtTime(
  labels: readonly LivestreamReplayLabel[],
  timeSec: number,
): LivestreamReplayLabel | null {
  for (const label of labels) {
    if (timeSec >= label.startSec && timeSec < label.endSec) return label;
  }
  return null;
}
