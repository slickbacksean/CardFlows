import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  TAB_CENTER_WIDTH,
  TAB_CIRCLE_RADIUS,
  TAB_CIRCLE_SIZE,
  TAB_ROW_HEIGHT,
} from "@/components/ui/tab-bar-metrics";
import { colors } from "@/lib/theme";

interface ScanTabButtonProps {
  onPress: () => void;
}

export function ScanTabButton({ onPress }: ScanTabButtonProps) {
  return (
    <Pressable
      accessibilityHint="Opens the livestream screener"
      accessibilityLabel="Livestream Screener"
      accessibilityRole="button"
      onPress={onPress}
      style={styles.hitTarget}
    >
      <View style={styles.circle}>
        <Ionicons color={colors.text} name="videocam-outline" size={28} />
      </View>
      <Text style={styles.label}>Livestream{"\n"}Screener</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hitTarget: {
    width: TAB_CENTER_WIDTH,
    height: TAB_ROW_HEIGHT,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  circle: {
    position: "absolute",
    top: -TAB_CIRCLE_RADIUS,
    width: TAB_CIRCLE_SIZE,
    height: TAB_CIRCLE_SIZE,
    borderRadius: TAB_CIRCLE_RADIUS,
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "600",
    lineHeight: 13,
    textAlign: "center",
    transform: [{ translateY: 5 }],
  },
});
