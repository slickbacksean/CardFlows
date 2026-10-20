import { TERMS_COPY, TERMS_DRAFT_BANNER, TERMS_EFFECTIVE_DATE, TERMS_SECTIONS, TERMS_VERSION } from "@cardflow/shared";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { colors } from "@/lib/theme";

/** Sean (Oct 19): the Terms of Service, readable before sign-up (same text as docs/TERMS_OF_SERVICE.md). */
export default function TermsScreen() {
  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title={TERMS_COPY.title} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.banner}>{TERMS_DRAFT_BANNER}</Text>
        <Text style={styles.meta}>{`Version ${TERMS_VERSION} · Effective ${TERMS_EFFECTIVE_DATE}`}</Text>
        {TERMS_SECTIONS.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>
              {section.heading}
            </Text>
            {section.paragraphs.map((p, i) => (
              <Text key={i} style={styles.body}>
                {p}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  banner: { color: colors.text, fontWeight: "700", fontSize: 15 },
  meta: { color: colors.muted, fontSize: 13 },
  section: { gap: 8 },
  heading: { color: colors.text, fontSize: 17, fontWeight: "700" },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
});
