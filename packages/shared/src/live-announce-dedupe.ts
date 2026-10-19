/**
 * Show-level announce dedupe for the livestream HUD.
 * Do not announce the same card id again within the window unless the user taps it.
 * Frame-source agnostic.
 */

export const LIVE_ANNOUNCE_DEDUPE_MS = 60_000;

export function createLiveAnnounceDedupe(windowMs = LIVE_ANNOUNCE_DEDUPE_MS) {
  const lastAnnounced = new Map<string, number>();

  return {
    /** True when this id should be announced (first time or outside the window). */
    shouldAnnounce(tcgdexId: string | null | undefined, nowMs: number): boolean {
      if (!tcgdexId) return false;
      const previous = lastAnnounced.get(tcgdexId);
      if (previous != null && nowMs - previous < windowMs) return false;
      return true;
    },
    noteAnnounced(tcgdexId: string, nowMs: number) {
      lastAnnounced.set(tcgdexId, nowMs);
    },
    /** User tap clears the cooldown so the same card can be announced again. */
    clear(tcgdexId?: string) {
      if (tcgdexId) lastAnnounced.delete(tcgdexId);
      else lastAnnounced.clear();
    },
  };
}

export type LiveAnnounceDedupe = ReturnType<typeof createLiveAnnounceDedupe>;
