import {
  HOW_THIS_WORKS_CLOSE_LABEL,
  HOW_THIS_WORKS_PARAGRAPHS,
  HOW_THIS_WORKS_TITLE,
} from "@cardflow/shared";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, space } from "@/lib/theme";
import { PrimaryButton } from "./primary-button";

interface HowThisWorksSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function HowThisWorksSheet({ visible, onClose }: HowThisWorksSheetProps) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
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
