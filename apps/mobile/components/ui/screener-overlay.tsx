import { useEffect, useState } from "react";
import { livestreamHudPageUrl, publishLivestreamHud } from "@/lib/huds";
import { getLiveOverlayGuess } from "@/lib/api";
import { LiveHudBubble } from "@/components/ui/live-hud-bubble";
import {
  emptyLiveOverlayGuess,
  isStableLiveIdentity,
  livestreamOverlayKind,
  livestreamOverlayUsesHud,
  type LiveOverlayGuess,
  type LiveVideoIdentityResult,
} from "@cardflow/shared";

export interface ScreenerOverlayProps {
  scannerOn: boolean;
  tabFocused?: boolean;
  unavailable?: boolean;
  liveIdentity?: LiveVideoIdentityResult | null;
  onBought?: (guess: LiveOverlayGuess) => void;
}

export function ScreenerOverlay({
  scannerOn,
  tabFocused = false,
  unavailable = false,
  liveIdentity = null,
  onBought,
}: ScreenerOverlayProps) {
  const [hudReady, setHudReady] = useState(false);
  const [liveGuess, setLiveGuess] = useState<LiveOverlayGuess | null>(null);
  const guessKey =
    unavailable || !scannerOn || !isStableLiveIdentity(liveIdentity)
      ? ""
      : `${liveIdentity.tcgdexId}:${liveIdentity.confidence ?? ""}`;
  const [guessKeySeen, setGuessKeySeen] = useState(guessKey);
  if (guessKeySeen !== guessKey) {
    setGuessKeySeen(guessKey);
    setLiveGuess(
      isStableLiveIdentity(liveIdentity)
        ? emptyLiveOverlayGuess(liveIdentity.tcgdexId, liveIdentity.confidence)
        : null,
    );
  }

  const overlayKind = livestreamOverlayKind({
    unavailable,
    scannerOn,
    liveGuessTcgdexId: liveGuess?.tcgdexId,
  });

  useEffect(() => {
    if (!tabFocused || !scannerOn) return;
    let cancelled = false;

    function checkHud() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      fetch(livestreamHudPageUrl(), { method: "GET", signal: controller.signal })
        .then((response) => {
          if (!cancelled) setHudReady(response.ok);
        })
        .catch(() => {
          if (!cancelled) setHudReady(false);
        })
        .finally(() => clearTimeout(timer));
    }

    checkHud();
    const interval = setInterval(checkHud, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [scannerOn, tabFocused]);

  useEffect(() => {
    if (!guessKey || !liveIdentity || !isStableLiveIdentity(liveIdentity)) return;
    let cancelled = false;
    const tcgdexId = liveIdentity.tcgdexId;
    const fallback = emptyLiveOverlayGuess(tcgdexId, liveIdentity.confidence);
    void getLiveOverlayGuess(tcgdexId, liveIdentity.confidence)
      .then((response) => {
        if (!cancelled) setLiveGuess(response.guess);
      })
      .catch(() => {
        if (!cancelled) setLiveGuess(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [guessKey, liveIdentity]);

  useEffect(() => {
    if (unavailable || !livestreamOverlayUsesHud(overlayKind, hudReady) || !liveIdentity) return;
    void publishLivestreamHud({
      scannerOn,
      identity: liveIdentity,
      guess: liveGuess,
    });
  }, [hudReady, liveGuess, liveIdentity, overlayKind, scannerOn, unavailable]);

  return <LiveHudBubble kind={overlayKind} liveGuess={liveGuess} onBought={onBought} />;
}
