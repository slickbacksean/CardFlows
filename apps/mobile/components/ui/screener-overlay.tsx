import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { WebView } from "react-native-webview";
import { livestreamHudPageUrl, publishLivestreamHud } from "@/lib/huds";
import { getLiveOverlayGuess } from "@/lib/api";
import { overlayDollarLabel } from "@/lib/livestream";
import { colors, space } from "@/lib/theme";
import {
  emptyLiveOverlayGuess,
  isStableLiveIdentity,
  LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
  LIVESTREAM_HUD_BUBBLE_EXPANDED_WIDTH,
  LIVESTREAM_HUD_BUBBLE_INSET,
  LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE,
  clampLivestreamHudBubbleOffset,
  livestreamHudBubbleSize,
  livestreamHudOriginWhitelist,
  livestreamOverlayKind,
  livestreamOverlayUsesHud,
  type LiveOverlayGuess,
  type LiveVideoIdentityResult,
  type LivestreamOverlayKind,
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
  const [expanded, setExpanded] = useState(false);
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
  const [kindSeen, setKindSeen] = useState(overlayKind);
  if (kindSeen !== overlayKind) {
    setKindSeen(overlayKind);
    if (overlayKind === "live_guess") setExpanded(true);
    if (overlayKind === "scanner_off" || overlayKind === "unavailable") setExpanded(false);
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

  const buyGuess = liveGuess?.tcgdexId ? liveGuess : null;
  const useHud = livestreamOverlayUsesHud(overlayKind, hudReady);

  return (
    <HudBubble
      expanded={expanded}
      kind={overlayKind}
      liveGuess={liveGuess}
      onToggle={() => setExpanded((current) => !current)}
    >
      {expanded ? (
        <View>
          {overlayKind === "unavailable" ? (
            <NativeOverlay liveGuess={null} scannerOn={false} unavailable />
          ) : useHud ? (
            <View accessibilityLabel="CardFlow overlay" style={styles.hudPane}>
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
          ) : (
            <NativeOverlay liveGuess={liveGuess} scannerOn={scannerOn} />
          )}
          {buyGuess && onBuy ? <BuyButton onPress={() => onBuy(buyGuess)} /> : null}
        </View>
      ) : null}
    </HudBubble>
  );
}

interface HudBubbleProps {
  expanded: boolean;
  kind: LivestreamOverlayKind;
  liveGuess: LiveOverlayGuess | null;
  onToggle: () => void;
  children?: ReactNode;
}

function HudBubble({ expanded, kind, liveGuess, onToggle, children }: HudBubbleProps) {
  const parentWidth = useSharedValue(0);
  const parentHeight = useSharedValue(0);
  const originX = useSharedValue(LIVESTREAM_HUD_BUBBLE_INSET);
  const originY = useSharedValue(LIVESTREAM_HUD_BUBBLE_INSET);
  const translateX = useSharedValue(LIVESTREAM_HUD_BUBBLE_INSET);
  const translateY = useSharedValue(LIVESTREAM_HUD_BUBBLE_INSET);
  const size = livestreamHudBubbleSize(expanded);

  function clampToParent(nextExpanded: boolean) {
    const bubble = livestreamHudBubbleSize(nextExpanded);
    const next = clampLivestreamHudBubbleOffset({
      x: translateX.value,
      y: translateY.value,
      parentWidth: parentWidth.value,
      parentHeight: parentHeight.value,
      bubbleWidth: bubble.width,
      bubbleHeight: bubble.height,
    });
    translateX.value = withSpring(next.x);
    translateY.value = withSpring(next.y);
    originX.value = next.x;
    originY.value = next.y;
  }

  function onHostLayout(event: LayoutChangeEvent) {
    parentWidth.value = event.nativeEvent.layout.width;
    parentHeight.value = event.nativeEvent.layout.height;
    clampToParent(expanded);
  }

  const pan = Gesture.Pan()
    .minDistance(8)
    .onUpdate((event) => {
      translateX.value = originX.value + event.translationX;
      translateY.value = originY.value + event.translationY;
    })
    .onEnd(() => {
      runOnJS(clampToParent)(expanded);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  return (
    <GestureHandlerRootView onLayout={onHostLayout} pointerEvents="box-none" style={styles.host}>
      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityLabel="CardFlow overlay bubble"
          pointerEvents="box-none"
          style={[styles.bubbleWrap, animatedStyle, { width: size.width }]}
        >
          {expanded ? (
            <View style={styles.card}>
              <Pressable
                accessibilityHint="Hides the overlay details and keeps the live page visible"
                accessibilityLabel="Collapse CardFlow overlay"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  onToggle();
                  clampToParent(false);
                }}
                style={styles.handle}
              >
                <Text style={styles.handleLabel}>CardFlow overlay</Text>
                <Ionicons color={colors.muted} name="chevron-down" size={18} />
              </Pressable>
              {children}
            </View>
          ) : (
            <CollapsedBubble
              kind={kind}
              liveGuess={liveGuess}
              onPress={() => {
                onToggle();
                clampToParent(true);
              }}
            />
          )}
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

interface CollapsedBubbleProps {
  kind: LivestreamOverlayKind;
  liveGuess: LiveOverlayGuess | null;
  onPress: () => void;
}

function CollapsedBubble({ kind, liveGuess, onPress }: CollapsedBubbleProps) {
  const name = liveGuess?.name ?? liveGuess?.tcgdexId;
  const estimateValue = overlayDollarLabel(liveGuess?.estimateAmount ?? null, "");
  const label =
    kind === "unavailable"
      ? LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE
      : kind === "live_guess" && name
        ? `${name} live guess`
        : kind === "looking"
          ? "CardFlow overlay, looking for a card"
          : "CardFlow overlay, no card confirmed";

  return (
    <Pressable
      accessibilityHint="Shows estimate and Max Buy without covering the live page"
      accessibilityLabel="Expand CardFlow overlay"
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.dot, kind === "looking" && styles.dotLooking, kind === "live_guess" && styles.dotGuess]}
    >
      {kind === "live_guess" && liveGuess?.imageUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel={`${name} catalog art`}
          contentFit="cover"
          source={{ uri: liveGuess.imageUrl }}
          style={styles.dotArt}
        />
      ) : (
        <View accessibilityLabel={label} style={styles.dotInner}>
          <Ionicons
            color={kind === "looking" || kind === "live_guess" ? colors.accent : colors.muted}
            name={kind === "unavailable" ? "videocam-off-outline" : "scan-outline"}
            size={26}
          />
        </View>
      )}
      {kind === "live_guess" && estimateValue ? (
        <View style={styles.dotBadge}>
          <Text numberOfLines={1} style={styles.dotBadgeLabel}>
            {estimateValue}
          </Text>
        </View>
      ) : null}
    </Pressable>
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
  host: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
  },
  bubbleWrap: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  card: {
    width: LIVESTREAM_HUD_BUBBLE_EXPANDED_WIDTH,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  handle: {
    minHeight: 36,
    paddingHorizontal: space.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
    backgroundColor: colors.chip,
  },
  handleLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  hudPane: {
    height: 148,
    backgroundColor: "transparent",
  },
  hudWebView: {
    flex: 1,
    backgroundColor: "transparent",
  },
  dot: {
    width: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
    height: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
    borderRadius: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE / 2,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  dotLooking: {
    borderColor: colors.accent,
  },
  dotGuess: {
    borderColor: colors.success,
  },
  dotInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  dotArt: {
    width: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
    height: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
    borderRadius: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE / 2,
  },
  dotBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: 64,
  },
  dotBadgeLabel: {
    color: colors.accentText,
    fontSize: 10,
    fontWeight: "800",
  },
  band: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.sm,
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
