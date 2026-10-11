import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { openLiveHudListing } from "@/lib/live-hud-listing";
import {
  loadLivestreamHudPosition,
  peekLivestreamHudPosition,
  persistLivestreamHudPosition,
} from "@/lib/live-hud-position";
import { colors, space } from "@/lib/theme";
import {
  LIVESTREAM_HUD_BUBBLE_INSET,
  LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE,
  liveHudListingUrl,
  liveHudPricesFromMatch,
  livestreamHudBubbleSize,
  livestreamHudOffsetFromSaved,
  snapLivestreamHudBubbleOffset,
  type LiveOverlayGuess,
  type LivestreamHudSavedPosition,
  type LivestreamOverlayKind,
} from "@cardflow/shared";

export interface LiveHudBubbleProps {
  kind: LivestreamOverlayKind;
  liveGuess?: LiveOverlayGuess | null;
  onBought?: (guess: LiveOverlayGuess) => void;
}

export function LiveHudBubble({ kind, liveGuess = null, onBought }: LiveHudBubbleProps) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [dismissedKey, setDismissedKey] = useState("");
  const matchKey =
    kind === "live_guess" && liveGuess?.tcgdexId ? liveGuess.tcgdexId : kind;
  const [matchKeySeen, setMatchKeySeen] = useState(matchKey);
  if (matchKeySeen !== matchKey) {
    setMatchKeySeen(matchKey);
    setExpanded(false);
    if (dismissedKey && dismissedKey !== matchKey) setDismissedKey("");
  }

  const parentWidth = useSharedValue(0);
  const parentHeight = useSharedValue(0);
  const originX = useSharedValue(LIVESTREAM_HUD_BUBBLE_INSET);
  const originY = useSharedValue(LIVESTREAM_HUD_BUBBLE_INSET);
  const translateX = useSharedValue(LIVESTREAM_HUD_BUBBLE_INSET);
  const translateY = useSharedValue(LIVESTREAM_HUD_BUBBLE_INSET);
  const size = livestreamHudBubbleSize(expanded);
  const prices = liveHudPricesFromMatch(liveGuess);
  const listingUrl = liveHudListingUrl(liveGuess);
  const dismissed = dismissedKey === matchKey;

  function applySnap(next: ReturnType<typeof snapLivestreamHudBubbleOffset>) {
    translateX.value = withSpring(next.x);
    translateY.value = withSpring(next.y);
    originX.value = next.x;
    originY.value = next.y;
    void persistLivestreamHudPosition({ edge: next.edge, y: next.y });
  }

  function snapCurrent(nextExpanded: boolean) {
    const bubble = livestreamHudBubbleSize(nextExpanded);
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
      bubbleWidth: size.width,
      bubbleHeight: size.height,
      safeLeft: insets.left,
      safeRight: insets.right,
    });
    translateX.value = next.x;
    translateY.value = next.y;
    originX.value = next.x;
    originY.value = next.y;
  }

  function onHostLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    const firstLayout = parentWidth.value <= 0 || parentHeight.value <= 0;
    parentWidth.value = width;
    parentHeight.value = height;
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
    snapCurrent(next);
  }

  function dismiss() {
    setExpanded(false);
    setDismissedKey(matchKey);
  }

  function finishPan(translationX: number, translationY: number, velocityY: number) {
    if (Math.abs(translationY) > 72 && Math.abs(velocityY) > 400) {
      dismiss();
      return;
    }
    snapCurrent(expanded);
  }

  const pan = Gesture.Pan()
    .minDistance(8)
    .onUpdate((event) => {
      translateX.value = originX.value + event.translationX;
      translateY.value = originY.value + event.translationY;
    })
    .onEnd((event) => {
      runOnJS(finishPan)(event.translationX, event.translationY, event.velocityY);
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
          style={[styles.card, animatedStyle, { width: size.width }]}
        >
          <GestureDetector gesture={tap}>
            <View style={styles.row}>
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
              <View style={styles.copy}>
                <Text numberOfLines={1} style={styles.name}>
                  {title}
                </Text>
                <Text style={styles.rawLabel}>Raw</Text>
                {prices.rawAmount ? <Text style={styles.rawValue}>{prices.rawAmount}</Text> : null}
              </View>
              <View style={styles.slabs}>
                <SlabSlot label="PSA 9" value={prices.psa9Amount} />
                <SlabSlot label="PSA 10" value={prices.psa10Amount} />
              </View>
            </View>
          </GestureDetector>
          {expanded ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityHint="Opens the catalog listing. Does not bid or buy."
                accessibilityLabel="Buy"
                accessibilityRole="button"
                disabled={!listingUrl}
                onPress={() => void openLiveHudListing(liveGuess)}
                style={[styles.buy, !listingUrl && styles.buyDisabled]}
              >
                <Text style={styles.buyLabel}>Buy</Text>
              </Pressable>
              {kind === "live_guess" && liveGuess?.tcgdexId && onBought ? (
                <Pressable
                  accessibilityHint="Opens the purchase sheet to save this card. Does not open the listing."
                  accessibilityLabel="I bought this"
                  accessibilityRole="button"
                  onPress={() => onBought(liveGuess)}
                  style={styles.bought}
                >
                  <Text style={styles.boughtLabel}>I bought this</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

function SlabSlot({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.slab}>
      <Text style={styles.slabLabel}>{label}</Text>
      {value ? <Text style={styles.slabValue}>{value}</Text> : null}
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
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  thumb: {
    width: 44,
    aspectRatio: 0.715,
    borderRadius: 8,
    backgroundColor: colors.chip,
  },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  name: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  rawLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  rawValue: { color: colors.success, fontSize: 22, fontWeight: "800" },
  slabs: { minWidth: 72, gap: 6, alignItems: "flex-end" },
  slab: { alignItems: "flex-end", gap: 1 },
  slabLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  slabValue: { color: colors.text, fontSize: 13, fontWeight: "800" },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  buy: {
    flex: 1,
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
  },
  buyDisabled: { opacity: 0.4 },
  buyLabel: { color: colors.bg, fontSize: 15, fontWeight: "800" },
  bought: {
    flex: 1,
    backgroundColor: "transparent",
    borderColor: "rgba(244, 241, 234, 0.28)",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
  },
  boughtLabel: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
});
