import Ionicons from "@expo/vector-icons/Ionicons";
import { readyToConfirm, scanQueueLabel } from "@cardflow/shared";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { openReadyScan, useScanQueue } from "@/lib/scan-queue";
import { colors, space } from "@/lib/theme";

/** P1-10: "N scans waiting for connection · M ready to confirm", plus a row per ready scan. */
export function ScanQueueList() {
  const router = useRouter();
  const queue = useScanQueue();
  const label = scanQueueLabel(queue);
  if (!label) return null;
  const ready = readyToConfirm(queue);
  return (
    <View style={styles.wrap}>
      <View accessibilityLiveRegion="polite" accessibilityRole="text" accessible style={styles.row}>
        <Ionicons color={colors.muted} name="images-outline" size={16} />
        <Text style={styles.text}>{label}</Text>
      </View>
      {ready.map((item, index) => (
        <Pressable
          accessibilityLabel={`Confirm offline scan ${index + 1}`}
          accessibilityRole="button"
          key={item.id}
          onPress={() => {
            const scanId = openReadyScan(item.id);
            if (scanId) router.push(`/scan/${scanId}`);
          }}
          style={styles.ready}
        >
          <Text style={styles.readyText}>Ready to confirm · scan {index + 1}</Text>
          <Ionicons color={colors.muted} name="chevron-forward" size={16} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs, paddingVertical: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.xs },
  text: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  ready: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.sm,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  readyText: { color: colors.text, fontSize: 15, fontWeight: "600" },
});
