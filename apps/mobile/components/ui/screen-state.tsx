import Ionicons from "@expo/vector-icons/Ionicons";
import NetInfo from "@react-native-community/netinfo";
import {
  errorAction,
  loadErrorCopy,
  SCREEN_STATE_COPY,
  SLOW_LOADING_MS,
  staleBannerCopy,
  startSlowTimer,
  type LoadErrorKind,
} from "@cardflow/shared";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { AccessibilityInfo, ActivityIndicator, findNodeHandle, Platform, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/components/ui/primary-button";
import { VALUE_HISTORY_CHART_HEIGHT } from "@/components/ui/value-history-chart";
import { colors, radii, space } from "@/lib/theme";

/**
 * P5 UX polish: the shared empty / loading / error states for every main
 * screen. Copy lives in @cardflow/shared screen-states.ts.
 */

type IconName = ComponentProps<typeof Ionicons>["name"];

const ERROR_ICONS: Record<LoadErrorKind, IconName> = {
  offline: "cloud-offline-outline",
  unreachable: "cloud-offline-outline",
  timeout: "time-outline",
  busy: "hourglass-outline",
  quota: "calendar-outline",
  server: "construct-outline",
  auth: "person-circle-outline",
  email_unverified: "mail-unread-outline",
  signup_required: "person-add-outline",
  premium_required: "star-outline",
  age_required: "shield-checkmark-outline",
  unknown: "alert-circle-outline",
};

/** UX review P1-3: move screen-reader focus to a new state's title (after one frame). */
function useFocusOnMount(enabled: boolean) {
  const ref = useRef<Text>(null);
  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() => {
      const node = ref.current ? findNodeHandle(ref.current) : null;
      if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled]);
  return ref;
}

/** UX review P1-1: true once `slowAfterMs` has passed; announced once. */
function useSlow(slowAfterMs: number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(
    () =>
      startSlowTimer(slowAfterMs, () => {
        setSlow(true);
        if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(SCREEN_STATE_COPY.stillWorking);
      }),
    [slowAfterMs],
  );
  return slow;
}

/**
 * Static placeholder blocks (no animation, so nothing to switch off for Reduce Motion).
 * "collection" draws the value chart at its real height, then tiles at the real width.
 */
export function ScreenLoading({
  label,
  variant = "list",
  rows = 4,
  tileWidth,
  slowAfterMs = SLOW_LOADING_MS.default,
}: {
  label: string;
  variant?: "list" | "grid" | "collection" | "spinner";
  rows?: number;
  tileWidth?: number;
  slowAfterMs?: number;
}) {
  const slow = useSlow(slowAfterMs);
  const stillWorking = slow ? (
    <Text accessibilityLiveRegion="polite" style={styles.body}>
      {SCREEN_STATE_COPY.stillWorking}
    </Text>
  ) : null;
  if (variant === "spinner") {
    return (
      <View style={styles.center}>
        <View accessibilityLabel={label} accessibilityRole="progressbar" accessibilityState={{ busy: true }} accessible>
          <ActivityIndicator color={colors.accent} />
        </View>
        <Text style={styles.body}>{SCREEN_STATE_COPY.loading}</Text>
        {stillWorking}
      </View>
    );
  }
  const tiles = variant === "grid" || variant === "collection";
  return (
    <View style={styles.list}>
      <View
        accessibilityLabel={label}
        accessibilityRole="progressbar"
        accessibilityState={{ busy: true }}
        accessible
        style={styles.list}
      >
        {variant === "collection" ? (
          <View style={styles.chartCard}>
            <View style={[styles.skeletonLine, { width: "30%" }]} />
            <View style={[styles.skeletonLine, styles.skeletonValue]} />
            <View style={[styles.skeletonBlock, { height: VALUE_HISTORY_CHART_HEIGHT }]} />
          </View>
        ) : null}
        <View style={tiles ? styles.grid : styles.list}>
          {Array.from({ length: rows }, (_, i) =>
            tiles ? (
              <View key={i} style={[styles.gridItem, tileWidth ? { width: tileWidth } : null]}>
                <View style={styles.skeletonImage} />
                <View style={[styles.skeletonLine, { width: "70%" }]} />
                <View style={[styles.skeletonLine, { width: "40%" }]} />
              </View>
            ) : (
              <View key={i} style={styles.listRow}>
                <View style={styles.skeletonThumb} />
                <View style={styles.listText}>
                  <View style={[styles.skeletonLine, { width: "65%" }]} />
                  <View style={[styles.skeletonLine, { width: "35%" }]} />
                </View>
              </View>
            ),
          )}
        </View>
      </View>
      {stillWorking}
    </View>
  );
}

type StateAction = { label: string; onPress: () => void };

export function ScreenEmpty({
  title,
  body,
  icon = "albums-outline",
  action,
  secondary,
  focusOnMount = false,
}: {
  title: string;
  body?: string;
  icon?: IconName;
  /** The primary next step (UX review P1-10: primary tone). */
  action?: StateAction;
  secondary?: StateAction;
  /** Set when this replaces a loading state, so screen readers land on it. */
  focusOnMount?: boolean;
}) {
  const titleRef = useFocusOnMount(focusOnMount);
  return (
    <View style={styles.center}>
      <Ionicons color={colors.muted} name={icon} size={36} />
      <Text accessibilityRole="header" ref={titleRef} style={styles.title}>
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? <PrimaryButton label={action.label} onPress={action.onPress} /> : null}
      {secondary ? <PrimaryButton label={secondary.label} onPress={secondary.onPress} tone="muted" /> : null}
    </View>
  );
}

/** NetInfo's view of the connection; null while unknown (Expo Go ships NetInfo). */
export function useConnected(): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void NetInfo.fetch()
      .then((state) => {
        if (!cancelled) setConnected(state.isConnected ?? null);
      })
      .catch(() => {});
    const unsubscribe = NetInfo.addEventListener((state) => setConnected(state.isConnected ?? null));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return connected;
}

/**
 * Full-screen load error: offline, can't reach CardFlow, timeout, busy, out of
 * allowance, server error, a known account step, or a plain "Couldn't load …".
 * Errors with a real fix (sign in, verify email, sign up) lead with that action
 * and keep "Try again" second (UX review P1-4).
 */
export function ScreenError({
  error,
  what,
  onRetry,
  retrying = false,
  secondary,
  note,
}: {
  error: unknown;
  /** Lower case, e.g. "your collection". */
  what: string;
  onRetry: () => void;
  retrying?: boolean;
  secondary?: StateAction;
  /** One extra plain line under the body (e.g. the Livestream marketplace note). */
  note?: string;
}) {
  const router = useRouter();
  const connected = useConnected();
  const copy = loadErrorCopy(error, what, connected);
  const fix = errorAction(error, connected);
  const titleRef = useFocusOnMount(true);
  const retryButton = (
    <PrimaryButton
      disabled={retrying}
      label={retrying ? SCREEN_STATE_COPY.retrying : SCREEN_STATE_COPY.retry}
      onPress={onRetry}
      tone={fix ? "muted" : "cta"}
    />
  );
  return (
    <View style={styles.center}>
      <Ionicons color={colors.muted} name={ERROR_ICONS[copy.kind]} size={36} />
      <Text accessibilityRole="header" ref={titleRef} style={styles.title}>
        {copy.title}
      </Text>
      <Text style={styles.body}>{copy.body}</Text>
      {note ? <Text style={styles.body}>{note}</Text> : null}
      {fix ? <PrimaryButton label={fix.label} onPress={() => router.push(fix.href)} /> : null}
      {retryButton}
      {secondary ? <PrimaryButton label={secondary.label} onPress={secondary.onPress} tone="muted" /> : null}
    </View>
  );
}

/**
 * UX review P0-1: a refresh failed but the screen still has data. Keep the data,
 * say how old it is, offer Try again.
 */
export function StaleBanner({
  loadedAt,
  kind = "generic",
  onRetry,
  retrying = false,
}: {
  loadedAt: number;
  kind?: "generic" | "prices";
  onRetry: () => void;
  retrying?: boolean;
}) {
  // Re-read the clock every 30 s so "5 minutes ago" stays true.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={styles.banner}>
      <View style={styles.inline}>
        <Ionicons color={colors.muted} name="information-circle-outline" size={18} />
        <Text style={styles.infoText}>{staleBannerCopy(kind, loadedAt, Math.max(now, loadedAt))}</Text>
      </View>
      <PrimaryButton
        disabled={retrying}
        label={retrying ? SCREEN_STATE_COPY.retrying : SCREEN_STATE_COPY.retry}
        onPress={onRetry}
        tone="muted"
      />
    </View>
  );
}

/** A muted information row (not an error), e.g. a failed status check. */
export function InfoRow({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.inline}>
      <Ionicons color={colors.muted} name="information-circle-outline" size={18} />
      <Text style={styles.infoText}>{message}</Text>
    </View>
  );
}

/** One-line error for a failed action, announced once. Optional fix action below it. */
export function InlineError({ message, action }: { message: string | null; action?: StateAction | null }) {
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.inlineWrap}>
      <View style={styles.inline}>
        <Ionicons color={colors.danger} name="alert-circle-outline" size={18} />
        <Text style={styles.inlineText}>{message}</Text>
      </View>
      {action ? <PrimaryButton label={action.label} onPress={action.onPress} tone="muted" /> : null}
    </View>
  );
}

// UX review P2-2: skeleton fills use cardBorder (about 1.4:1 on bg); colors.card was ~1.1:1.
// P2-3: no fixed lineHeight anywhere here, so text never clips at large font sizes.
const SKELETON = colors.cardBorder;

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.lg * 2 },
  title: { color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center" },
  body: { color: colors.muted, fontSize: 15, textAlign: "center" },
  list: { gap: space.sm },
  listRow: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  listText: { flex: 1, gap: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  gridItem: { width: "47%", gap: 6 },
  chartCard: {
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.md,
    gap: space.xs,
  },
  skeletonValue: { width: "50%", height: 28 },
  skeletonBlock: { borderRadius: radii.sm, backgroundColor: SKELETON },
  skeletonImage: { aspectRatio: 63 / 88, borderRadius: radii.md, backgroundColor: SKELETON },
  // Same box as the Grade rows' thumb (72 wide, 0.715).
  skeletonThumb: { width: 72, aspectRatio: 0.715, borderRadius: radii.sm, backgroundColor: SKELETON },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: SKELETON },
  banner: { gap: space.xs },
  inlineWrap: { gap: space.xs },
  inline: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  inlineText: { color: colors.danger, fontSize: 14, flexShrink: 1 },
  infoText: { color: colors.muted, fontSize: 14, flexShrink: 1 },
});
