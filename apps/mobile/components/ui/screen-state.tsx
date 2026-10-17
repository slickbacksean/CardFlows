import Ionicons from "@expo/vector-icons/Ionicons";
import NetInfo from "@react-native-community/netinfo";
import { loadErrorCopy, SCREEN_STATE_COPY, type LoadErrorKind } from "@cardflow/shared";
import { useEffect, useState, type ComponentProps } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/components/ui/primary-button";
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
  server: "construct-outline",
  auth: "person-circle-outline",
  unknown: "alert-circle-outline",
};

/** Static placeholder blocks (no shimmer, so nothing to switch off for Reduce Motion). */
export function ScreenLoading({
  label,
  variant = "list",
  rows = 4,
}: {
  label: string;
  variant?: "list" | "grid" | "spinner";
  rows?: number;
}) {
  if (variant === "spinner") {
    return (
      <View accessibilityLabel={label} accessibilityRole="progressbar" accessible style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.body}>{SCREEN_STATE_COPY.loading}</Text>
      </View>
    );
  }
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" accessible style={variant === "grid" ? styles.grid : styles.list}>
      {Array.from({ length: rows }, (_, i) =>
        variant === "grid" ? (
          <View key={i} style={styles.gridItem}>
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
  );
}

export function ScreenEmpty({
  title,
  body,
  icon = "albums-outline",
  action,
}: {
  title: string;
  body?: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.center}>
      <Ionicons color={colors.muted} name={icon} size={36} />
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? <PrimaryButton label={action.label} onPress={action.onPress} tone="muted" /> : null}
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
 * Full-screen load error: offline, can't reach CardFlow, timeout, busy,
 * server error or a plain "Couldn't load …", with one Try again button.
 */
export function ScreenError({
  error,
  what,
  onRetry,
  retrying = false,
  secondary,
}: {
  error: unknown;
  /** Lower case, e.g. "your collection". */
  what: string;
  onRetry: () => void;
  retrying?: boolean;
  secondary?: { label: string; onPress: () => void };
}) {
  const connected = useConnected();
  const copy = loadErrorCopy(error, what, connected);
  return (
    <View accessibilityLiveRegion="polite" style={styles.center}>
      <Ionicons color={colors.muted} name={ERROR_ICONS[copy.kind]} size={36} />
      <Text accessibilityRole="header" style={styles.title}>
        {copy.title}
      </Text>
      <Text style={styles.body}>{copy.body}</Text>
      <PrimaryButton
        disabled={retrying}
        label={retrying ? SCREEN_STATE_COPY.retrying : SCREEN_STATE_COPY.retry}
        onPress={onRetry}
      />
      {secondary ? <PrimaryButton label={secondary.label} onPress={secondary.onPress} tone="muted" /> : null}
    </View>
  );
}

/** One-line error for a failed action, announced once. */
export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.inline}>
      <Ionicons color={colors.danger} name="alert-circle-outline" size={18} />
      <Text style={styles.inlineText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.lg * 2 },
  title: { color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center" },
  body: { color: colors.muted, fontSize: 15, textAlign: "center" },
  list: { gap: space.sm },
  listRow: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  listText: { flex: 1, gap: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  gridItem: { width: "47%", gap: 6 },
  skeletonImage: { aspectRatio: 63 / 88, borderRadius: radii.md, backgroundColor: colors.card },
  skeletonThumb: { width: 44, height: 60, borderRadius: radii.sm, backgroundColor: colors.card },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: colors.card },
  inline: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  inlineText: { color: colors.danger, fontSize: 14, flexShrink: 1 },
});
