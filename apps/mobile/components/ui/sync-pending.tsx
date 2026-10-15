import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";
import { writeQueueLabel } from "@cardflow/shared";
import { useWriteQueueCount } from "@/lib/write-queue";
import { colors, space } from "@/lib/theme";

/** P1-09: small "N waiting to sync" indicator; renders nothing when the queue is empty. */
export function SyncPending() {
  const label = writeQueueLabel(useWriteQueueCount());
  if (!label) return null;
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="text" accessible style={styles.row}>
      <Ionicons color={colors.muted} name="cloud-upload-outline" size={16} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingVertical: space.xs },
  text: { color: colors.muted, fontSize: 13, fontWeight: "600" },
});
