import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, space } from "@/lib/theme";

export type PreferencesDismissKind = "close" | "back";

interface PreferencesScreenHeaderProps {
  title: string;
  dismiss: PreferencesDismissKind;
}

export function leavePreferencesStack(router: {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: "/(tabs)/collection") => void;
}): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace("/(tabs)/collection");
}

export function PreferencesScreenHeader({ title, dismiss }: PreferencesScreenHeaderProps) {
  const router = useRouter();
  const accessibilityLabel = dismiss === "close" ? "Close" : "Back";
  const iconName = dismiss === "close" ? "close" : "chevron-back";

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => leavePreferencesStack(router)}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name={iconName} size={28} />
        </Pressable>
        <Text numberOfLines={1} style={styles.topTitle}>
          {title}
        </Text>
        <View style={styles.iconButton} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.bg },
  topBar: {
    paddingHorizontal: space.md,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  topTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
});
