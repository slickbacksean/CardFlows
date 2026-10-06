/**
 * Livestream overlay chrome for device QA.
 * Live guess never mints inventory. Confirm does not fill this overlay.
 */

export type LivestreamOverlayKind = "unavailable" | "scanner_off" | "looking" | "live_guess";

export interface LivestreamOverlayKindInput {
  unavailable?: boolean;
  scannerOn: boolean;
  liveGuessTcgdexId?: string | null;
}

/**
 * Scanner OFF → “Scanner off”, never a live identity and never a Confirm leftover.
 * Scanner ON, no stable guess → “looking”.
 * Two stable hits → live guess (does not mint).
 */
export function livestreamOverlayKind(input: LivestreamOverlayKindInput): LivestreamOverlayKind {
  if (input.unavailable) return "unavailable";
  if (!input.scannerOn) return "scanner_off";
  if (input.liveGuessTcgdexId) return "live_guess";
  return "looking";
}

/** HUDS hosts looking / guess / scanner-off. */
export function livestreamOverlayUsesHud(
  kind: LivestreamOverlayKind,
  hudReady: boolean,
): boolean {
  return hudReady && kind !== "unavailable";
}
