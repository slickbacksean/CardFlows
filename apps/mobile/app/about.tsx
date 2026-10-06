import {
  ABOUT_LEGAL_REVIEW_NOTE,
  ABOUT_POKECOLLECTOR_SOURCE_LABEL,
  ABOUT_POKECOLLECTOR_SOURCE_URL,
  aboutBodyParagraphs,
  aboutParagraphIsPokecollectorSource,
} from "@cardflow/shared";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { colors, space } from "@/lib/theme";

export default function AboutScreen() {
  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title="About" />
      <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
        {aboutBodyParagraphs().map((paragraph) =>
          aboutParagraphIsPokecollectorSource(paragraph) ? (
            <Pressable
              accessibilityLabel={ABOUT_POKECOLLECTOR_SOURCE_LABEL}
              accessibilityRole="link"
              key={paragraph}
              onPress={() => void Linking.openURL(ABOUT_POKECOLLECTOR_SOURCE_URL)}
            >
              <Text style={styles.link}>{paragraph}</Text>
            </Pressable>
          ) : (
            <Text key={paragraph} style={styles.body}>
              {paragraph}
            </Text>
          ),
        )}
        <Text style={styles.note}>{ABOUT_LEGAL_REVIEW_NOTE}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: space.lg,
    paddingBottom: 48,
    gap: space.md,
  },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  link: { color: colors.accent, fontSize: 15, lineHeight: 22, fontWeight: "700" },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: space.sm },
});
