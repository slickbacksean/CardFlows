/** P1-23: screen-reader copy that must not rely on color. */

/** "+6.0%" / "−3.0%" / "0.0%". The arrow and sign carry the direction, not the color. */
export function signedPercent(pct: number): string {
  if (pct > 0) return `+${pct.toFixed(1)}%`;
  if (pct < 0) return `\u2212${Math.abs(pct).toFixed(1)}%`;
  return "0.0%";
}

export function changeArrow(change: number | null): string {
  if (change == null || change === 0) return "\u2192";
  return change > 0 ? "\u25B2" : "\u25BC";
}

/** One summary label for the whole value chart; individual points stay hidden. */
export function chartSummaryLabel(input: {
  todayDisplay: string | null;
  changePct: number | null;
  rangeLabel: string;
}): string {
  const today = input.todayDisplay ? `${input.todayDisplay} today` : "No estimate yet";
  if (input.changePct == null) return `MyDEX value. ${today}.`;
  const dir = input.changePct > 0 ? "up" : input.changePct < 0 ? "down" : "unchanged";
  const amount = input.changePct === 0 ? "" : ` ${Math.abs(input.changePct).toFixed(1)}%`;
  return `MyDEX value. ${today}, ${dir}${amount} over ${input.rangeLabel}.`;
}
