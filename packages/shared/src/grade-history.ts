
/** Per-card pre-grade estimate history. Estimates only, never an official grade. */
export const GRADE_HISTORY_TITLE = "Pre-grade estimate history";
export const GRADE_HISTORY_NOTE = "Estimate only. Not an official grade.";
export const GRADE_HISTORY_MAX = 8;
/** Sean: free users see their 10 most recent estimates per card; older ones stay saved, locked. */
export const GRADE_HISTORY_FREE_VISIBLE = 10;
/** Premium sees the whole saved history (bounded for the response size). */
export const GRADE_HISTORY_PREMIUM_MAX = 100;

export function gradeHistoryLockedLine(lockedCount: number): string | null {
  const n = Math.max(0, Math.floor(lockedCount));
  if (n === 0) return null;
  return `${n} older ${n === 1 ? "estimate" : "estimates"} saved, not deleted. Upgrade to see them.`;
}

export interface GradeHistoryEntry {
  at: string;
  overall: number;
  confidence: string | null;
}

export function appendGradeHistory(
  history: readonly GradeHistoryEntry[],
  estimate: { overall: number | null; confidence?: string | null },
  at: string,
): GradeHistoryEntry[] {
  if (estimate.overall == null || !Number.isFinite(estimate.overall) || estimate.overall < 1) {
    return [...history];
  }
  const last = history[history.length - 1];
  const next: GradeHistoryEntry = { at, overall: estimate.overall, confidence: estimate.confidence ?? null };
  if (last && last.overall === next.overall && Math.abs(Date.parse(at) - Date.parse(last.at)) < 60_000) {
    return [...history];
  }
  return [...history, next].slice(-GRADE_HISTORY_MAX);
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Newest first: "Oct 14 · 8.5 · up 0.5". */
export function gradeHistoryLines(history: readonly GradeHistoryEntry[]): string[] {
  const lines = history.map((entry, index) => {
    const previous = history[index - 1];
    const delta = previous ? Math.round((entry.overall - previous.overall) * 10) / 10 : 0;
    const change = !previous ? "first" : delta === 0 ? "no change" : delta > 0 ? `up ${delta}` : `down ${Math.abs(delta)}`;
    return `${shortDate(entry.at)} · ${entry.overall} · ${change}`;
  });
  return lines.reverse();
}

export function parseGradeHistory(raw: string | null | undefined): GradeHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is GradeHistoryEntry =>
        typeof entry?.at === "string" && typeof entry?.overall === "number",
    );
  } catch {
    return [];
  }
}
