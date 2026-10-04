export function shouldShowFinalPoints(estimate: number, finalPoints: number): boolean {
  return finalPoints !== estimate * 10;
}

export function formatEstimate(estimate: number): string {
  return estimate.toFixed(1);
}

/** Display-only rounding of a server number. Does not recompute the blend. */
export function formatServerPoints(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return (Math.round(value * 10) / 10).toFixed(1);
}
