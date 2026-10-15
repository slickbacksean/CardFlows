import Ionicons from "@expo/vector-icons/Ionicons";
import { STATUS_POLL_MS } from "@cardflow/shared";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { getStatus } from "@/lib/api";
import { colors, space } from "@/lib/theme";

/** P1-21: server-driven status messages ("Prices are delayed…"). Renders nothing when all is well. */
export function StatusBanner() {
  const { data } = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: STATUS_POLL_MS,
    staleTime: STATUS_POLL_MS / 2,
    retry: false,
  });
  const banners = data?.banners ?? [];
  if (banners.length === 0) return null;
  return (
    <View accessibilityLiveRegion="polite" style={styles.wrap}>
      {banners.map((banner) => (
        <View accessibilityRole="text" accessible key={banner.id} style={styles.row}>
          <Ionicons
            color={banner.severity === "warning" ? colors.danger : colors.muted}
            name={banner.severity === "warning" ? "alert-circle-outline" : "information-circle-outline"}
            size={16}
          />
          <Text style={styles.text}>{banner.message}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs, paddingVertical: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.xs },
  text: { color: colors.text, fontSize: 13, fontWeight: "600", flexShrink: 1 },
});
