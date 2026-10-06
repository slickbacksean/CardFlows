import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { livestreamHudPageUrl, publishLivestreamHud } from "@/lib/huds";
import { getLiveOverlayGuess } from "@/lib/api";
import { overlayDollarLabel } from "@/lib/livestream";
import { colors, space } from "@/lib/theme";
import {
  emptyLiveOverlayGuess,
  isStableLiveIdentity,
  LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE,
  livestreamHudOriginWhitelist,
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
  onBuy?: (guess: LiveOverlayGuess) => void;
}

export function ScreenerOverlay({
  scannerOn,
  tabFocused = false,
  unavailable = false,
  liveIdentity = null,
  onBuy,
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

  if (overlayKind === "unavailable") {
    return <NativeOverlay liveGuess={null} scannerOn={false} unavailable />;
  }

  if (livestreamOverlayUsesHud(overlayKind, hudReady)) {
    return (
      <View>
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
          originWhitelist={livestreamHudOriginWhitelist(livestreamHudPageUrl())}
          setSupportMultipleWindows={false}
          source={{ uri: livestreamHudPageUrl() }}
          style={styles.hudWebView}
        />
        </View>
        {buyGuess && onBuy ? <BuyButton onPress={() => onBuy(buyGuess)} /> : null}
      </View>
    );
  }

  return (
    <View>
      <NativeOverlay liveGuess={liveGuess} scannerOn={scannerOn} />
      {buyGuess && onBuy ? <BuyButton onPress={() => onBuy(buyGuess)} /> : null}
    </View>
  );
}

function BuyButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.buyButton}>
      <Text style={styles.buyLabel}>I bought this</Text>
    </Pressable>
  );
}

interface NativeOverlayProps {
  scannerOn: boolean;
  unavailable?: boolean;
  liveGuess?: LiveOverlayGuess | null;
}

function NativeOverlay({
  scannerOn,
  unavailable = false,
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
            <Text style={styles.body}>Live-video identify is native iOS and Android only.</Text>
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
    return (
      <View accessibilityLabel="CardFlow overlay, looking for a card" style={styles.band}>
        <View style={styles.row}>
          <View accessibilityLabel="No catalog art" style={styles.thumb} />
          <View style={styles.copy}>
            <Text style={styles.name}>Looking for a card…</Text>
            <Text style={styles.body}>Live-video identify is on.</Text>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.sm,
  },
  hudBand: {
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
    height: 148,
  },
  hudWebView: {
    flex: 1,
    backgroundColor: colors.card,
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
  buyLabel: { color: colors.bg, fontSize: 16, fontWeight: "800" },
  figureValue: { color: colors.text, fontSize: 16, fontWeight: "800" },
  figureMeta: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 16 },
});
