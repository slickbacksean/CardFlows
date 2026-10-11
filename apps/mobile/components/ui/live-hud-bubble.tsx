import { Image } from "expo-image";
import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  loadLivestreamHudPosition,
  peekLivestreamHudPosition,
  persistLivestreamHudPosition,
} from "@/lib/live-hud-position";
import { colors, space } from "@/lib/theme";
import {
  LIVESTREAM_HUD_BUBBLE_INSET,
  LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE,
  liveHudPricesFromMatch,
  liveHudQuickSavePayload,
  livestreamHudBubbleSize,
  livestreamHudBubbleWidth,
  livestreamHudOffsetFromSaved,
  snapLivestreamHudBubbleOffset,
  type LiveHudQuickSavePayload,
  type LiveOverlayGuess,
  type LivestreamHudSavedPosition,
  type LivestreamOverlayKind,
} from "@cardflow/shared";

export interface LiveHudBubbleProps {
  kind: LivestreamOverlayKind;
  liveGuess?: LiveOverlayGuess | null;
  onPurchased?: (guess: LiveOverlayGuess, payload: LiveHudQuickSavePayload) => void | Promise<void>;
  onAddDetails?: (guess: LiveOverlayGuess) => void;
}

export function LiveHudBubble({
  kind,
  liveGuess = null,
  onPurchased,
  onAddDetails,
}: LiveHudBubbleProps) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [dismissedKey, setDismissedKey] = useState("");
  const [barWidth, setBarWidth] = useState(0);
  const [priceDraft, setPriceDraft] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [toast, setToast] = useState<{ key: string; name: string; guess: LiveOverlayGuess } | null>(
    null,
  );
  const matchKey =
    kind === "live_guess" && liveGuess?.tcgdexId ? liveGuess.tcgdexId : kind;
  const [matchKeySeen, setMatchKeySeen] = useState(matchKey);
  if (matchKeySeen !== matchKey) {
    setMatchKeySeen(matchKey);
    setExpanded(false);
    setPromptOpen(false);
    setPriceDraft("");
    if (dismissedKey && dismissedKey !== matchKey) setDismissedKey("");
  }

  const parentWidth = useSharedValue(0);
  const parentHeight = useSharedValue(0);
  const originY = useSharedValue(LIVESTREAM_HUD_BUBBLE_INSET);
  const translateX = useSharedValue(LIVESTREAM_HUD_BUBBLE_INSET);
  const translateY = useSharedValue(LIVESTREAM_HUD_BUBBLE_INSET);
  const size = livestreamHudBubbleSize(expanded, {
    parentWidth: barWidth > 0 ? barWidth + LIVESTREAM_HUD_BUBBLE_INSET * 2 + insets.left + insets.right : 0,
    safeLeft: insets.left,
    safeRight: insets.right,
  });
  const width = barWidth || size.width;
  const prices = liveHudPricesFromMatch(liveGuess);
  const dismissed = dismissedKey === matchKey;
  const canPurchase = kind === "live_guess" && Boolean(liveGuess?.tcgdexId && onPurchased);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function applySnap(next: ReturnType<typeof snapLivestreamHudBubbleOffset>) {
    translateX.value = next.x;
    translateY.value = withSpring(next.y);
    originY.value = next.y;
    void persistLivestreamHudPosition({ edge: next.edge });
  }

  function snapCurrent(nextExpanded: boolean) {
    const bubble = livestreamHudBubbleSize(nextExpanded, {
      parentWidth: parentWidth.value,
      safeLeft: insets.left,
      safeRight: insets.right,
    });
    applySnap(
      snapLivestreamHudBubbleOffset({
        x: translateX.value,
        y: translateY.value,
        parentWidth: parentWidth.value,
        parentHeight: parentHeight.value,
        bubbleWidth: bubble.width,
        bubbleHeight: bubble.height,
        safeLeft: insets.left,
        safeRight: insets.right,
      }),
    );
  }

  function restoreSaved(position: LivestreamHudSavedPosition) {
    const next = livestreamHudOffsetFromSaved({
      position,
      parentWidth: parentWidth.value,
      parentHeight: parentHeight.value,
      bubbleWidth: size.width || livestreamHudBubbleWidth({
        parentWidth: parentWidth.value,
        safeLeft: insets.left,
        safeRight: insets.right,
      }),
      bubbleHeight: size.height,
      safeLeft: insets.left,
      safeRight: insets.right,
    });
    translateX.value = next.x;
    translateY.value = next.y;
    originY.value = next.y;
  }

  function onHostLayout(event: LayoutChangeEvent) {
    const { width: nextWidth, height } = event.nativeEvent.layout;
    const firstLayout = parentWidth.value <= 0 || parentHeight.value <= 0;
    parentWidth.value = nextWidth;
    parentHeight.value = height;
    const nextBar = livestreamHudBubbleWidth({
      parentWidth: nextWidth,
      safeLeft: insets.left,
      safeRight: insets.right,
    });
    if (barWidth !== nextBar) setBarWidth(nextBar);
    if (!firstLayout) {
      snapCurrent(expanded);
      return;
    }
    restoreSaved(peekLivestreamHudPosition());
    void loadLivestreamHudPosition().then((position) => {
      if (parentWidth.value > 0) restoreSaved(position);
    });
  }

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (!next) setPromptOpen(false);
    snapCurrent(next);
  }

  function dismiss() {
    setExpanded(false);
    setPromptOpen(false);
    setDismissedKey(matchKey);
  }

  function finishPan(translationY: number, velocityY: number) {
    if (Math.abs(translationY) > 72 && Math.abs(velocityY) > 400) {
      dismiss();
      return;
    }
    snapCurrent(expanded);
  }

  async function savePurchase(typedPrice?: string) {
    if (!liveGuess?.tcgdexId || !onPurchased || savingKey === matchKey) return;
    const built = liveHudQuickSavePayload({
      match: liveGuess,
      purchasePrice: typedPrice ?? priceDraft,
    });
    if (!built.ok) {
      setExpanded(true);
      setPromptOpen(true);
      snapCurrent(true);
      return;
    }
    setSavingKey(matchKey);
    try {
      await onPurchased(liveGuess, built.payload);
      setPromptOpen(false);
      setPriceDraft("");
      setToast({
        key: `${liveGuess.tcgdexId}:${Date.now()}`,
        name: liveGuess.name ?? liveGuess.tcgdexId,
        guess: liveGuess,
      });
    } finally {
      setSavingKey("");
    }
  }

  const pan = Gesture.Pan()
    .minDistance(8)
    .onUpdate((event) => {
      translateY.value = originY.value + event.translationY;
    })
    .onEnd((event) => {
      runOnJS(finishPan)(event.translationY, event.velocityY);
    });

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(toggleExpanded)();
  });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  if (dismissed) return <View pointerEvents="box-none" style={styles.host} />;

  const title =
    kind === "unavailable"
      ? LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE
      : kind === "looking"
        ? "Looking for a card…"
        : kind === "live_guess"
          ? (liveGuess?.name ?? liveGuess?.tcgdexId ?? "Live guess")
          : "Scanner off";
  const name = liveGuess?.name ?? liveGuess?.tcgdexId;

  return (
    <GestureHandlerRootView onLayout={onHostLayout} pointerEvents="box-none" style={styles.host}>
      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityLabel="CardFlow overlay bubble"
          entering={FadeInDown.springify().duration(280)}
          key={matchKey}
          pointerEvents="auto"
          style={[styles.card, animatedStyle, width ? { width } : null]}
        >
          <GestureDetector gesture={tap}>
            <View style={styles.body}>
              <View style={styles.prices}>
                <PriceSlot label="Raw" large tone="raw" value={prices.rawAmount} />
                <PriceSlot label="PSA 9" large value={prices.psa9Amount} />
                <PriceSlot label="PSA 10" large value={prices.psa10Amount} />
              </View>
              <View style={styles.identity}>
                {kind === "live_guess" && liveGuess?.imageUrl ? (
                  <Image
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={`${name} catalog art`}
                    contentFit="cover"
                    source={{ uri: liveGuess.imageUrl }}
                    style={styles.thumb}
                  />
                ) : (
                  <View accessibilityLabel="No catalog art" style={styles.thumb} />
                )}
                <Text numberOfLines={1} style={styles.name}>
                  {title}
                </Text>
              </View>
            </View>
          </GestureDetector>
          {expanded && canPurchase ? (
            <View style={styles.actions}>
              {promptOpen ? (
                <TextInput
                  accessibilityLabel="Purchase price"
                  keyboardType="decimal-pad"
                  onChangeText={setPriceDraft}
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                  style={styles.priceInput}
                  value={priceDraft}
                />
              ) : null}
              <Pressable
                accessibilityHint="Saves this card as purchased with USD defaults. Does not read the live page."
                accessibilityLabel="Purchased"
                accessibilityRole="button"
                disabled={savingKey === matchKey}
                onPress={() => void savePurchase()}
                style={[styles.purchased, savingKey === matchKey && styles.purchasedDisabled]}
              >
                <Text style={styles.purchasedLabel}>
                  {savingKey === matchKey ? "Saving…" : "Purchased"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
      {toast ? (
        <View pointerEvents="box-none" style={styles.toast}>
          <Text numberOfLines={1} style={styles.toastCopy}>
            Saved {toast.name}
          </Text>
          {onAddDetails ? (
            <Pressable
              accessibilityHint="Opens the purchase sheet to edit details."
              accessibilityLabel="Add details"
              accessibilityRole="button"
              onPress={() => onAddDetails(toast.guess)}
              style={styles.toastAction}
            >
              <Text style={styles.toastActionLabel}>Add details</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </GestureHandlerRootView>
  );
}

function PriceSlot({
  label,
  value,
  large,
  tone,
}: {
  label: string;
  value: string | null;
  large?: boolean;
  tone?: "raw";
}) {
  return (
    <View style={styles.priceSlot}>
      <Text style={styles.priceLabel}>{label}</Text>
      {value ? (
        <Text style={[styles.priceValue, large && styles.priceValueLarge, tone === "raw" && styles.rawValue]}>
          {value}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
  },
  card: {
    position: "absolute",
    left: 0,
    top: 0,
    backgroundColor: "rgba(16, 20, 24, 0.88)",
    borderColor: "rgba(244, 241, 234, 0.12)",
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: space.sm,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    gap: 8,
  },
  body: { gap: 8 },
  prices: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space.sm,
  },
  priceSlot: { flex: 1, minWidth: 0, gap: 2 },
  priceLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  priceValue: { color: colors.text, fontSize: 18, fontWeight: "800" },
  priceValueLarge: { fontSize: 26, letterSpacing: -0.4 },
  rawValue: { color: colors.success },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  thumb: {
    width: 28,
    aspectRatio: 0.715,
    borderRadius: 6,
    backgroundColor: colors.chip,
  },
  name: { flex: 1, color: colors.muted, fontSize: 13, fontWeight: "600" },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  priceInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    fontSize: 15,
    fontWeight: "700",
  },
  purchased: {
    backgroundColor: colors.success,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  purchasedDisabled: { opacity: 0.5 },
  purchasedLabel: { color: colors.bg, fontSize: 13, fontWeight: "800" },
  toast: {
    position: "absolute",
    left: LIVESTREAM_HUD_BUBBLE_INSET,
    right: LIVESTREAM_HUD_BUBBLE_INSET,
    bottom: LIVESTREAM_HUD_BUBBLE_INSET,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(16, 20, 24, 0.92)",
    borderColor: "rgba(244, 241, 234, 0.16)",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: space.sm,
    paddingVertical: 10,
  },
  toastCopy: { flex: 1, color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  toastAction: { paddingHorizontal: 8, paddingVertical: 4 },
  toastActionLabel: { color: colors.accent, fontSize: 13, fontWeight: "800" },
});
