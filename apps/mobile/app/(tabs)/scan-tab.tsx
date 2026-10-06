import Ionicons from "@expo/vector-icons/Ionicons";
import {
  LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE,
  type LiveOverlayGuess,
  type LiveVideoIdentityResult,
  type TcgdexVariants,
} from "@cardflow/shared";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LivestreamBrowser, type LivestreamBrowserHandle } from "@/components/ui/livestream-browser";
import { PrimaryButton } from "@/components/ui/primary-button";
import { PurchaseSheet, type PurchaseSavePayload } from "@/components/ui/purchase-sheet";
import { ScreenerOverlay } from "@/components/ui/screener-overlay";
import { saveLivestreamPurchase } from "@/lib/api";
import {
  injectMockLiveVideoCard,
  startLiveVideoIdentify,
  stopLiveVideoIdentify,
  subscribeLiveVideoIdentity,
} from "@/lib/live-identify";
import {
  DEFAULT_LIVESTREAM_PLATFORM,
  LIVESTREAM_PLATFORM_ORDER,
  LIVESTREAM_PLATFORMS,
  type LivestreamPlatform,
} from "@/lib/livestream";
import { colors, space } from "@/lib/theme";

type LiveLoadState = "ready" | "error";

export default function ScanTabScreen() {
  const router = useRouter();
  const [platform, setPlatform] = useState<LivestreamPlatform>(DEFAULT_LIVESTREAM_PLATFORM);
  const [loadState, setLoadState] = useState<LiveLoadState>("ready");
  const [scannerOn, setScannerOn] = useState(false);
  const [pageOn, setPageOn] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [browserEpoch, setBrowserEpoch] = useState(0);
  const [tabFocused, setTabFocused] = useState(true);
  const [liveIdentity, setLiveIdentity] = useState<LiveVideoIdentityResult | null>(null);
  const [buyGuess, setBuyGuess] = useState<LiveOverlayGuess | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [isSavingBuy, setIsSavingBuy] = useState(false);
  const browserRef = useRef<LivestreamBrowserHandle>(null);
  const chrome = LIVESTREAM_PLATFORMS[platform];
  const scannerUnavailable = Platform.OS === "web";

  useEffect(() => subscribeLiveVideoIdentity(setLiveIdentity), []);

  useFocusEffect(
    useCallback(() => {
      setTabFocused(true);
      return () => {
        setTabFocused(false);
        stopLiveVideoIdentify();
        setScannerOn(false);
      };
    }, []),
  );

  function openCollection() {
    router.navigate("/(tabs)/collection");
  }

  function retryLivePage() {
    setLoadState("ready");
    setBrowserEpoch((epoch) => epoch + 1);
  }

  function selectPlatform(next: LivestreamPlatform) {
    setPlatform(next);
    setLoadState("ready");
    setBrowserEpoch((epoch) => epoch + 1);
    if (scannerOn) {
      stopLiveVideoIdentify();
      startLiveVideoIdentify();
    }
  }

  async function onSaveLivePurchase(payload: PurchaseSavePayload) {
    if (!buyGuess) return;
    setIsSavingBuy(true);
    setBuyError(null);
    try {
      await saveLivestreamPurchase({
        tcgdexId: buyGuess.tcgdexId,
        ...payload,
      });
      setBuyGuess(null);
    } catch (caught) {
      setBuyError(caught instanceof Error ? caught.message : "Could not save that purchase");
    } finally {
      setIsSavingBuy(false);
    }
  }

  function toggleScanner() {
    if (scannerUnavailable) return;
    const next = !scannerOn;
    setScannerOn(next);
    if (next) startLiveVideoIdentify();
    else stopLiveVideoIdentify();
  }

  if (loadState === "error") {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.errorBar}>
          <Pressable
            accessibilityHint="Returns to Collection"
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={12}
            onPress={openCollection}
            style={styles.iconButton}
          >
            <Ionicons color={colors.text} name="close" size={26} />
          </Pressable>
          <Text numberOfLines={1} style={styles.errorTitle}>
            Livestream Screener
          </Text>
          <View style={styles.iconButton} />
        </View>
        <View style={styles.errorBody}>
          <Text style={styles.errorMessage}>Could not load the live page.</Text>
          <PrimaryButton label="Try again" onPress={retryLivePage} />
          <PrimaryButton label="Open Collection" onPress={openCollection} tone="muted" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.chrome}>
        <View style={styles.urlBar}>
          <Pressable
            accessibilityHint="Returns to Collection"
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={12}
            onPress={openCollection}
            style={styles.iconButton}
          >
            <Ionicons color={colors.text} name="close" size={26} />
          </Pressable>
          <Pressable
            accessibilityHint="Goes back in the live page"
            accessibilityLabel="Back"
            accessibilityRole="button"
            disabled={!canGoBack}
            hitSlop={8}
            onPress={() => browserRef.current?.goBack()}
            style={styles.iconButton}
          >
            <Ionicons color={canGoBack ? colors.text : colors.muted} name="chevron-back" size={22} />
          </Pressable>
          <Pressable
            accessibilityHint="Goes forward in the live page"
            accessibilityLabel="Forward"
            accessibilityRole="button"
            disabled={!canGoForward}
            hitSlop={8}
            onPress={() => browserRef.current?.goForward()}
            style={styles.iconButton}
          >
            <Ionicons
              color={canGoForward ? colors.text : colors.muted}
              name="chevron-forward"
              size={22}
            />
          </Pressable>
          <View accessibilityLabel={chrome.label} style={styles.siteBadge}>
            <Text style={styles.siteBadgeLabel}>{chrome.badge}</Text>
          </View>
          <Text
            accessibilityLabel={chrome.urlLabel}
            accessibilityRole="text"
            numberOfLines={1}
            style={styles.urlLabel}
          >
            {chrome.urlLabel}
          </Text>
          {scannerUnavailable ? (
            <Text
              accessibilityLabel={LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE}
              style={styles.scannerUnavailable}
            >
              {LIVESTREAM_SCANNER_UNAVAILABLE_MESSAGE}
            </Text>
          ) : (
            <View style={styles.liveBadges}>
              <View
                accessibilityLabel={pageOn ? "Page on" : "Page off"}
                style={[styles.pageBadge, pageOn ? styles.pageBadgeOn : styles.pageBadgeOff]}
              >
                <Text style={[styles.pageBadgeLabel, pageOn && styles.pageBadgeLabelOn]}>
                  {pageOn ? "PAGE ON" : "PAGE"}
                </Text>
              </View>
              <Pressable
                accessibilityHint="Starts live-video identify without taking a screenshot"
                accessibilityLabel="Scanner"
                accessibilityRole="switch"
                accessibilityState={{ checked: scannerOn }}
                hitSlop={8}
                onPress={toggleScanner}
                style={[styles.scannerBadge, scannerOn ? styles.scannerBadgeOn : styles.scannerBadgeOff]}
              >
                <Text style={[styles.scannerBadgeLabel, scannerOn && styles.scannerBadgeLabelOn]}>
                  {scannerOn ? "SCANNER ON" : "SCANNER"}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
        <View accessibilityRole="tablist" style={styles.segments}>
          {LIVESTREAM_PLATFORM_ORDER.map((id) => (
            <SegmentButton
              key={id}
              label={LIVESTREAM_PLATFORMS[id].label}
              onPress={() => selectPlatform(id)}
              selected={platform === id}
            />
          ))}
        </View>
      </View>
      <View accessibilityLabel={chrome.liveRegionLabel} style={styles.liveRegion}>
        <LivestreamBrowser
          liveRegionLabel={chrome.liveRegionLabel}
          onLoadError={() => setLoadState("error")}
          onPageStateChange={(state) => {
            setCanGoBack(state.canGoBack);
            setCanGoForward(state.canGoForward);
            setPageOn(state.pageOn);
          }}
          ref={browserRef}
          reloadKey={browserEpoch}
          url={chrome.pageUrl}
          visible={tabFocused && loadState === "ready"}
        />
        <View pointerEvents="box-none" style={styles.hudLayer}>
          <ScreenerOverlay
            liveIdentity={liveIdentity}
            onBuy={(guess) => {
              setBuyError(null);
              setBuyGuess(guess);
            }}
            scannerOn={scannerOn}
            tabFocused={tabFocused}
            unavailable={scannerUnavailable}
          />
        </View>
        {__DEV__ ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setLoadState("error")}
            style={styles.devToggle}
          >
            <Text style={styles.devToggleLabel}>DEV  Preview load failure</Text>
          </Pressable>
        ) : null}
        {__DEV__ && scannerOn && !scannerUnavailable ? (
          <Pressable
            accessibilityHint="Feeds a live-video frame with a card in view. Does not screenshot the page."
            accessibilityLabel="Simulate card in live video"
            accessibilityRole="button"
            onPress={() => injectMockLiveVideoCard("base1-58")}
            style={styles.devCardInView}
          >
            <Text style={styles.devToggleLabel}>DEV  Card in live video</Text>
          </Pressable>
        ) : null}
      </View>
      <PurchaseSheet
        error={buyError}
        isSaving={isSavingBuy}
        localId={buyGuess?.number ?? ""}
        name={buyGuess?.name ?? buyGuess?.tcgdexId ?? "Card"}
        onClose={() => {
          if (!isSavingBuy) setBuyGuess(null);
        }}
        onSave={(payload) => void onSaveLivePurchase(payload)}
        selectedVariant="normal"
        setName={buyGuess?.setName ?? ""}
        variants={LIVE_PURCHASE_VARIANTS}
        visible={buyGuess !== null}
      />
    </SafeAreaView>
  );
}

const LIVE_PURCHASE_VARIANTS: TcgdexVariants = {
  normal: true,
  holo: true,
  reverse: true,
  firstEdition: false,
  wPromo: false,
};

interface SegmentButtonProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function SegmentButton({ label, selected, onPress }: SegmentButtonProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.segment}
    >
      <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
        {label}
      </Text>
      {selected ? <View style={styles.segmentUnderline} /> : <View style={styles.segmentSpacer} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  chrome: {
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  urlBar: {
    minHeight: 44,
    paddingHorizontal: space.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  siteBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  siteBadgeLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  urlLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  scannerBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: colors.chip,
  },
  scannerBadgeOff: {
    borderColor: colors.cardBorder,
  },
  scannerBadgeOn: {
    borderColor: colors.success,
  },
  scannerBadgeLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  scannerBadgeLabelOn: {
    color: colors.success,
  },
  scannerUnavailable: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
    maxWidth: 88,
    textAlign: "right",
  },
  liveBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pageBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: colors.chip,
    borderColor: colors.cardBorder,
  },
  pageBadgeOn: {
    borderColor: colors.accent,
  },
  pageBadgeOff: {
    borderColor: colors.cardBorder,
  },
  pageBadgeLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  pageBadgeLabelOn: {
    color: colors.accent,
  },
  segments: {
    flexDirection: "row",
    gap: space.lg,
    paddingHorizontal: space.md,
  },
  segment: { paddingBottom: 2 },
  segmentLabel: { color: colors.muted, fontSize: 16, fontWeight: "700" },
  segmentLabelSelected: { color: colors.text },
  segmentUnderline: {
    height: 2,
    backgroundColor: colors.accent,
    marginTop: 6,
    borderRadius: 1,
  },
  segmentSpacer: { height: 2, marginTop: 6 },
  liveRegion: {
    flex: 1,
    backgroundColor: colors.chip,
    overflow: "hidden",
  },
  hudLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  errorBar: {
    paddingHorizontal: space.sm,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
  },
  errorTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  errorBody: {
    flex: 1,
    padding: space.lg,
    gap: space.md,
  },
  errorMessage: { color: colors.text, fontSize: 22, fontWeight: "800" },
  devToggle: {
    position: "absolute",
    right: space.sm,
    bottom: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    zIndex: 3,
  },
  devToggleLabel: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  devCardInView: {
    position: "absolute",
    left: space.sm,
    bottom: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    zIndex: 3,
  },
});
