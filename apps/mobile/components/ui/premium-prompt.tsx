import { PREMIUM_PROMPT_COPY, premiumFeatureLine, type PremiumFeature } from "@cardflow/shared";
import { StyleSheet, Text, View } from "react-native";
import { colors, radii, space } from "@/lib/theme";

/** D14: short "premium is coming" note. No IAP yet; prices come from PREMIUM_PLACEHOLDER_PRICING. */
export function PremiumPrompt({ feature }: { feature: PremiumFeature }) {
  return (
    <View accessible accessibilityLabel={`${PREMIUM_PROMPT_COPY.title}. ${premiumFeatureLine(feature)}`} style={styles.card}>
      <Text style={styles.title}>{PREMIUM_PROMPT_COPY.title}</Text>
      <Text style={styles.body}>{premiumFeatureLine(feature)}</Text>
      <Text style={styles.body}>{PREMIUM_PROMPT_COPY.plans}</Text>
      <Text style={styles.caption}>{PREMIUM_PROMPT_COPY.includes}</Text>
      <Text style={styles.caption}>{PREMIUM_PROMPT_COPY.notYet}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.lg, padding: space.md, gap: 4 },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  caption: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
