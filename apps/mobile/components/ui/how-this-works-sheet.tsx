import {
  HOW_THIS_WORKS_CLOSE_LABEL,
  HOW_THIS_WORKS_PARAGRAPHS,
  HOW_THIS_WORKS_TITLE,
} from "@cardflow/shared";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, space } from "@/lib/theme";
import { PrimaryButton } from "./primary-button";

interface HowThisWorksSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function HowThisWorksSheet({ visible, onClose }: HowThisWorksSheetProps) {
  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Pressable
        accessibilityLabel="Dismiss how this works"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.dismiss}
      />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.handle} />
        <Text accessibilityRole="header" style={styles.title}>
          {HOW_THIS_WORKS_TITLE}
        </Text>
        <ScrollView contentContainerStyle={styles.body}>
          {HOW_THIS_WORKS_PARAGRAPHS.map((paragraph) => (
            <Text key={paragraph} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </ScrollView>
        <PrimaryButton label={HOW_THIS_WORKS_CLOSE_LABEL} onPress={onClose} tone="muted" />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    zIndex: 20,
  },
  dismiss: { flex: 1 },
  sheet: {
    maxHeight: "72%",
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.muted,
    marginBottom: space.xs,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  body: { gap: space.md, paddingBottom: space.sm },
  paragraph: { color: colors.muted, fontSize: 15, lineHeight: 22 },
});
