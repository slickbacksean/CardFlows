import { LIVESTREAM_PAYWALL_COPY, PREMIUM_PROMPT_COPY, premiumFeatureLine, type PremiumFeature } from "@cardflow/shared";
import { StyleSheet, Text, View } from "react-native";
import { isPremiumIapEnabled } from "@/lib/premium-purchase";
import { colors, radii, space } from "@/lib/theme";

/**
 * D14: short "premium is coming" note. Sean (Oct 20): while IAP is off
 * (EXPO_PUBLIC_CARD_FLOW_IAP_ENABLED unset) no placeholder price appears; only "Subscriptions are opening soon."
 */
export function PremiumPrompt({ feature }: { feature: PremiumFeature }) {
  const iapOn = isPremiumIapEnabled();
  return (
    <View accessible accessibilityLabel={`${PREMIUM_PROMPT_COPY.title}. ${premiumFeatureLine(feature)}`} style={styles.card}>
      <Text style={styles.title}>{PREMIUM_PROMPT_COPY.title}</Text>
      <Text style={styles.body}>{premiumFeatureLine(feature)}</Text>
      {iapOn ? <Text style={styles.body}>{PREMIUM_PROMPT_COPY.plans}</Text> : null}
      <Text style={styles.caption}>{PREMIUM_PROMPT_COPY.includes}</Text>
      <Text style={styles.caption}>{iapOn ? PREMIUM_PROMPT_COPY.notYet : LIVESTREAM_PAYWALL_COPY.openingSoon}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.lg, padding: space.md, gap: 4 },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  caption: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
