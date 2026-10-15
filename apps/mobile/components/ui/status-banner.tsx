import Ionicons from "@expo/vector-icons/Ionicons";
import { STATUS_POLL_MS } from "@cardflow/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { getStatus } from "@/lib/api";
import { colors, space } from "@/lib/theme";

/**
 * P1-21: server-driven status messages ("Prices are delayed…"). Renders nothing when all is well.
 * Its own full-width row. Announced once when a new banner appears, never on a refetch that
 * returns the same banners (no live region, which would re-read every 60 s poll).
 */
export function StatusBanner() {
  const { data } = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: STATUS_POLL_MS,
    staleTime: STATUS_POLL_MS / 2,
    retry: false,
  });
  const banners = data?.banners ?? [];
  const idsKey = banners.map((b) => b.id).join(",");
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    const fresh = banners.filter((b) => !seen.current.has(b.id));
    seen.current = new Set(ids);
    if (fresh.length > 0) {
      AccessibilityInfo.announceForAccessibility(fresh.map((b) => `${b.severity === "warning" ? "Warning" : "Notice"}: ${b.message}`).join(" "));
    }
    // Only when the set of banner IDs changes, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  if (banners.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {banners.map((banner) => {
        const warning = banner.severity === "warning";
        return (
          <View
            accessibilityLabel={`${warning ? "Warning" : "Notice"}: ${banner.message}`}
            accessibilityRole="text"
            accessible
            key={banner.id}
            style={[styles.row, { borderColor: warning ? colors.danger : colors.cardBorder }]}
          >
            <Ionicons
              color={warning ? colors.danger : colors.muted}
              name={warning ? "alert-circle-outline" : "information-circle-outline"}
              size={20}
              style={styles.icon}
            />
            <Text style={styles.text}>{banner.message}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch", width: "100%", gap: space.xs, paddingVertical: space.xs },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.xs,
    padding: space.sm,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: colors.card,
  },
  icon: { marginTop: 2 },
  text: { color: colors.text, fontSize: 15, flexShrink: 1 },
});
