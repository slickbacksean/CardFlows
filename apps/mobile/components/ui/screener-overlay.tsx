import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import {
  HudBubble,
  playPurchasedSuccessHaptic,
  PurchasedUndoToast,
} from "@/components/ui/hud-bubble";
import { livestreamHudPageUrl, publishLivestreamHud } from "@/lib/huds";
import { getLiveOverlayGuess } from "@/lib/api";
import { overlayDollarLabel } from "@/lib/livestream";
import { colors, space } from "@/lib/theme";
import {
  emptyLiveOverlayGuess,
  isStableLiveIdentity,
  LIVESTREAM_SCANNER_UNAVAILABLE_DETAIL,
  LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE,
  livestreamHudOriginWhitelist,
  livestreamOverlayKind,
  livestreamOverlayUsesHud,
  PURCHASED_UNDO_TOAST_MS,
  shouldAcceptLiveHudPurchaseTap,
  type LiveOverlayGuess,
  type LiveVideoIdentityResult,
} from "@cardflow/shared";

export interface ScreenerOverlayProps {
  scannerOn: boolean;
  tabFocused?: boolean;
  unavailable?: boolean;
  liveIdentity?: LiveVideoIdentityResult | null;
  onPurchased?: (
    guess: LiveOverlayGuess,
  ) => void | Promise<void | { inventoryItemId: string }>;
  onUndoPurchased?: (inventoryItemId: string) => void | Promise<void>;
}

export function ScreenerOverlay({
  scannerOn,
  tabFocused = false,
  unavailable = false,
  liveIdentity = null,
  onPurchased,
  onUndoPurchased,
}: ScreenerOverlayProps) {
  const [hudReady, setHudReady] = useState(false);
  const [liveGuess, setLiveGuess] = useState<LiveOverlayGuess | null>(null);
  const [savingKey, setSavingKey] = useState("");
  const [savedKeys, setSavedKeys] = useState<string[]>([]);
  const [toast, setToast] = useState<{ inventoryItemId: string; matchKey: string } | null>(
    null,
  );
  const [undoing, setUndoing] = useState(false);
  const savingKeyRef = useRef("");
  const savedKeysRef = useRef<string[]>([]);
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
    if (!toast) return;
    AccessibilityInfo.announceForAccessibility("Marked Purchased. Undo is available.");
    const timer = setTimeout(() => setToast(null), PURCHASED_UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (unavailable || !hudReady || !liveIdentity) return;
    void publishLivestreamHud({
      scannerOn,
      identity: liveIdentity,
      guess: liveGuess,
    });
  }, [hudReady, liveGuess, liveIdentity, scannerOn, unavailable]);

  const overlayKind = livestreamOverlayKind({
    unavailable,
    scannerOn,
    liveGuessTcgdexId: liveGuess?.tcgdexId,
  });

  const buyGuess = liveGuess?.tcgdexId ? liveGuess : null;
  const matchKey = buyGuess?.tcgdexId ?? "";
  const readingCard =
    scannerOn && !buyGuess && liveIdentity?.reason === "unidentified";
  const bubble = overlayBubbleCopy(overlayKind, liveGuess, readingCard);

  async function savePurchase() {
    if (!buyGuess?.tcgdexId || !onPurchased) return;
    if (
      !shouldAcceptLiveHudPurchaseTap({
        matchKey,
        inFlightKey: savingKeyRef.current,
        savedKeys: savedKeysRef.current,
      })
    ) {
      return;
    }
    savingKeyRef.current = matchKey;
    setSavingKey(matchKey);
    try {
      const result = await onPurchased(buyGuess);
      await playPurchasedSuccessHaptic();
      const inventoryItemId =
        result && typeof result === "object" ? result.inventoryItemId : undefined;
      if (!inventoryItemId) return;
      if (!savedKeysRef.current.includes(matchKey)) {
        savedKeysRef.current = [...savedKeysRef.current, matchKey];
        setSavedKeys(savedKeysRef.current);
      }
      setToast({ inventoryItemId, matchKey });
    } finally {
      savingKeyRef.current = "";
      setSavingKey("");
    }
  }

  async function undoPurchase() {
    if (!toast || !onUndoPurchased || undoing) return;
    const pending = toast;
    setUndoing(true);
    try {
      await onUndoPurchased(pending.inventoryItemId);
      savedKeysRef.current = savedKeysRef.current.filter((key) => key !== pending.matchKey);
      setSavedKeys(savedKeysRef.current);
      setToast(null);
      AccessibilityInfo.announceForAccessibility("Purchased undone");
    } finally {
      setUndoing(false);
    }
  }

  const purchasedControl =
    buyGuess && onPurchased ? (
      <PurchasedButton
        disabled={savingKey === matchKey || savedKeys.includes(matchKey)}
        onPress={() => void savePurchase()}
        saving={savingKey === matchKey}
      />
    ) : null;
  const confirmation =
    toast ? (
      <PurchasedUndoToast onUndo={() => void undoPurchase()} undoing={undoing} />
    ) : null;

  if (overlayKind === "unavailable") {
    return (
      <HudBubble live={false} subtitle={bubble.subtitle} title={bubble.title}>
        <NativeOverlay liveGuess={null} scannerOn={false} unavailable />
      </HudBubble>
    );
  }

  if (livestreamOverlayUsesHud(overlayKind, hudReady)) {
    return (
      <HudBubble live={bubble.live} subtitle={bubble.subtitle} title={bubble.title}>
        <View accessibilityLabel="CardFlow overlay" style={styles.hudBand}>
          <WebView
            javaScriptEnabled
            onError={() => setHudReady(false)}
            onHttpError={() => setHudReady(false)}
            onLoadEnd={() => {
              if (!liveIdentity) return;
              void publishLivestreamHud({
                scannerOn,
                identity: liveIdentity,
                guess: liveGuess,
              });
            }}
            opaque={false}
            originWhitelist={livestreamHudOriginWhitelist(livestreamHudPageUrl())}
            setSupportMultipleWindows={false}
            source={{ uri: livestreamHudPageUrl() }}
            style={styles.hudWebView}
          />
        </View>
        {purchasedControl}
        {confirmation}
      </HudBubble>
    );
  }

  return (
    <HudBubble live={bubble.live} subtitle={bubble.subtitle} title={bubble.title}>
      <NativeOverlay liveGuess={liveGuess} readingCard={readingCard} scannerOn={scannerOn} />
      {purchasedControl}
      {confirmation}
    </HudBubble>
  );
}

function overlayBubbleCopy(
  kind: ReturnType<typeof livestreamOverlayKind>,
  liveGuess: LiveOverlayGuess | null,
  readingCard = false,
): { title: string; subtitle: string; live: boolean } {
  if (kind === "unavailable") {
    return {
      title: "Scanner unavailable",
      subtitle: "iOS and Android only",
      live: false,
    };
  }
  if (kind === "live_guess" && liveGuess?.tcgdexId) {
    const name = liveGuess.name ?? liveGuess.tcgdexId;
    return {
      title: name,
      subtitle: `Estimate ${overlayDollarLabel(liveGuess.estimateAmount, "No estimate")}`,
      live: true,
    };
  }
  if (kind === "looking" && readingCard) {
    return { title: "Reading this card…", subtitle: "Matching the live crop", live: true };
  }
  if (kind === "looking") {
    return { title: "Looking for a card…", subtitle: "Live video on", live: true };
  }
  return { title: "Scanner off", subtitle: "Tap for guidance", live: false };
}

function PurchasedButton({
  onPress,
  saving,
  disabled,
}: {
  onPress: () => void;
  saving: boolean;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityHint="Saves this card as purchased. Cost details can be added later. Does not read the live page."
      accessibilityLabel="Purchased"
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.buyButton, disabled && styles.buyButtonDisabled]}
    >
      <Text style={styles.buyLabel}>{saving ? "Saving…" : "Purchased"}</Text>
    </Pressable>
  );
}

interface NativeOverlayProps {
  scannerOn: boolean;
  unavailable?: boolean;
  readingCard?: boolean;
  liveGuess?: LiveOverlayGuess | null;
}

function NativeOverlay({
  scannerOn,
  unavailable = false,
  readingCard = false,
  liveGuess = null,
}: NativeOverlayProps) {
  const kind = livestreamOverlayKind({
    unavailable,
    scannerOn,
    liveGuessTcgdexId: liveGuess?.tcgdexId,
  });

  if (kind === "unavailable") {
    return (
      <View accessibilityLabel={LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE} style={styles.band}>
        <View style={styles.row}>
          <View accessibilityLabel="No catalog art" style={styles.thumb} />
          <View style={styles.copy}>
            <Text style={styles.name}>{LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE}</Text>
            <Text style={styles.body}>{LIVESTREAM_SCANNER_UNAVAILABLE_DETAIL}</Text>
          </View>
        </View>
      </View>
    );
  }

  if (kind === "live_guess" && liveGuess?.tcgdexId) {
    const name = liveGuess.name ?? liveGuess.tcgdexId;
    const setLine = [liveGuess.setName, liveGuess.number].filter(Boolean).join(" · ");
    const estimateValue = overlayDollarLabel(liveGuess.estimateAmount, "No estimate");
    const maxBuyValue = overlayDollarLabel(liveGuess.maxBuyAmount, "—");
    return (
      <View
        accessibilityLabel={`${name} live guess, Estimate ${estimateValue}, Max Buy ${maxBuyValue}, Grade —, not confirmed`}
        style={styles.band}
      >
        <View style={styles.row}>
          {liveGuess.imageUrl ? (
            <Image
              accessibilityIgnoresInvertColors
              accessibilityLabel={`${name} catalog art`}
              contentFit="cover"
              source={{ uri: liveGuess.imageUrl }}
              style={styles.thumb}
            />
          ) : (
            <View accessibilityLabel={`${name} live guess`} style={styles.thumb} />
          )}
          <View style={styles.copy}>
            <Text numberOfLines={1} style={styles.name}>
              {name}
            </Text>
            <Text style={styles.body}>
              {setLine ? `${setLine} · Live guess · not confirmed` : "Live guess · not confirmed"}
            </Text>
            <View style={styles.figures}>
              <OverlayFigure label="Estimate" meta="not a market" value={estimateValue} />
              <OverlayFigure label="Max Buy" meta="guidance" value={maxBuyValue} />
              <OverlayFigure label="Grade" meta="not a cert" value="—" />
            </View>
          </View>
        </View>
        <Text style={styles.caption}>CardFlow overlay · not a market</Text>
      </View>
    );
  }

  if (kind === "looking") {
    const title = readingCard ? "Reading this card…" : "Looking for a card…";
    const body = readingCard ? "Matching the live crop." : "Live-video identify is on.";
    return (
      <View
        accessibilityLabel={
          readingCard ? "CardFlow overlay, reading a card" : "CardFlow overlay, looking for a card"
        }
        style={styles.band}
      >
        <View style={styles.row}>
          <View accessibilityLabel="No catalog art" style={styles.thumb} />
          <View style={styles.copy}>
            <Text style={styles.name}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
            <HudEmptyFigures />
          </View>
        </View>
        <Text style={styles.caption}>CardFlow overlay · not a market</Text>
      </View>
    );
  }

  return (
    <View accessibilityLabel="CardFlow overlay, no card confirmed" style={styles.band}>
      <View style={styles.row}>
        <View accessibilityLabel="No catalog art" style={styles.thumb} />
        <View style={styles.copy}>
          <Text style={styles.name}>Scanner off</Text>
          <Text style={styles.body}>Turn the scanner on to identify from live video.</Text>
          <HudEmptyFigures />
        </View>
      </View>
      <Text style={styles.caption}>CardFlow overlay · not a market</Text>
    </View>
  );
}

interface OverlayFigureProps {
  label: string;
  value: string;
  meta: string;
}

function OverlayFigure({ label, value, meta }: OverlayFigureProps) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={styles.figureValue}>{value}</Text>
      <Text style={styles.figureMeta}>{meta}</Text>
    </View>
  );
}

function HudEmptyFigures() {
  return (
    <View style={styles.figures}>
      <OverlayFigure label="Estimate" meta="not a market" value="No estimate" />
      <OverlayFigure label="Max Buy" meta="guidance" value="—" />
      <OverlayFigure label="Grade" meta="not a cert" value="—" />
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: colors.card,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    gap: space.sm,
  },
  hudBand: {
    backgroundColor: "transparent",
    height: 132,
  },
  hudWebView: {
    flex: 1,
    backgroundColor: "transparent",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
  },
  thumb: {
    width: 52,
    aspectRatio: 0.715,
    borderRadius: 8,
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  name: { color: colors.text, fontSize: 17, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  figures: {
    flexDirection: "row",
    gap: space.sm,
    marginTop: 2,
  },
  figure: { flex: 1, minWidth: 0, gap: 1 },
  figureLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  buyButton: {
    marginHorizontal: space.md,
    marginBottom: space.sm,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  buyButtonDisabled: { opacity: 0.5 },
  buyLabel: { color: colors.bg, fontSize: 16, fontWeight: "800" },
  figureValue: { color: colors.text, fontSize: 16, fontWeight: "800" },
  figureMeta: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 16 },
});
