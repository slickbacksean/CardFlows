import { LOCKED_DISPLAY_CURRENCY } from "@cardflow/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, space, type } from "@/lib/theme";

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
    color: colors.text,
    ...type.title,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  usd: {
    color: colors.accentText,
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
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
