import Ionicons from "@expo/vector-icons/Ionicons";
import { readyToConfirm, scanCapturedTimeLabel, scanQueueLabel } from "@cardflow/shared";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { openReadyScan, useScanQueue } from "@/lib/scan-queue";
import { colors, space } from "@/lib/theme";

/** P1-10: "N scans waiting for connection · M ready to confirm", plus a row per ready scan. */
export function ScanQueueList() {
  const router = useRouter();
  const queue = useScanQueue();
  const label = scanQueueLabel(queue);
  const ready = readyToConfirm(queue);
  const pending = queue.items.filter((i) => i.status === "pending").length;
  const lastPending = useRef(pending);

  // Announce once when every queued scan has uploaded, not on each item.
  useEffect(() => {
    if (lastPending.current > 0 && pending === 0 && ready.length > 0) {
      AccessibilityInfo.announceForAccessibility(`All scans uploaded. ${ready.length} ready to confirm.`);
    }
    lastPending.current = pending;
  }, [pending, ready.length]);

  if (!label) return null;
  return (
    <View style={styles.wrap}>
      <View accessibilityRole="text" accessible style={styles.row}>
        <Ionicons color={colors.muted} name="images-outline" size={16} style={styles.icon} />
        <Text style={styles.text}>{label}</Text>
      </View>
      {ready.map((item) => {
        const time = scanCapturedTimeLabel(item.capturedAt);
        return (
          <Pressable
            accessibilityLabel={`Confirm scan taken at ${time}`}
            accessibilityRole="button"
            key={item.id}
            onPress={() => {
              const scanId = openReadyScan(item.id);
              if (scanId) router.push(`/scan/${scanId}`);
            }}
            style={styles.ready}
          >
            {item.fileUri ? (
              <Image accessible={false} contentFit="cover" source={{ uri: item.fileUri }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]} />
            )}
            <Text style={styles.readyText}>Scan from {time}</Text>
            <Ionicons color={colors.muted} name="chevron-forward" size={16} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs, paddingVertical: space.xs },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.xs },
  icon: { marginTop: 2 },
  text: { color: colors.text, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  ready: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  thumb: { width: 40, height: 56, borderRadius: 4 },
  thumbEmpty: { backgroundColor: colors.chip },
  readyText: { color: colors.text, fontSize: 15, fontWeight: "600", flexShrink: 1, flex: 1 },
});
