export function shouldShowFinalPoints(estimate: number, finalPoints: number): boolean {
  return finalPoints !== estimate * 10;
}

export function formatEstimate(estimate: number): string {
  return estimate.toFixed(1);
}
