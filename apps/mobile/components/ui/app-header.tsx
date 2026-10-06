import { LOCKED_DISPLAY_CURRENCY } from "@cardflow/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, space } from "@/lib/theme";

export function AppHeader() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Text accessibilityRole="header" style={styles.wordmark}>
          CardFlow
        </Text>
        <View style={styles.actions}>
          <Text accessibilityLabel={`Currency ${LOCKED_DISPLAY_CURRENCY}`} style={styles.usd}>
            {LOCKED_DISPLAY_CURRENCY}
          </Text>
          <Pressable
            accessibilityLabel="Open Settings"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              router.push("/settings");
            }}
            style={styles.avatar}
          >
            <Ionicons color={colors.text} name="person" size={18} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
  },
  bar: {
    minHeight: 48,
    paddingHorizontal: space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  wordmark: {
    color: colors.accent,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  usd: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
});
