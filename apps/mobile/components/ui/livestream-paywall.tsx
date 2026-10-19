import {
  LIVESTREAM_PAYWALL_COPY,
  PREMIUM_LEGAL_URLS,
} from "@cardflow/shared";
import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/components/ui/primary-button";
import {
  isPremiumIapEnabled,
  restorePremiumPurchases,
  startPremiumPurchase,
} from "@/lib/premium-purchase";
import { colors, radii, space } from "@/lib/theme";

/**
 * Sean (Oct 19): shown when the livestream 3-day trial has ended.
 * Subscribe goes through `startPremiumPurchase()` (IAP stub until StoreKit ships).
 */
export function LivestreamPaywall({ onDismiss }: { onDismiss?: () => void }) {
  const [busy, setBusy] = useState(false);
  const iapOn = isPremiumIapEnabled();

  const runPurchase = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await startPremiumPurchase();
      if (!result.ok) {
        Alert.alert(LIVESTREAM_PAYWALL_COPY.subscribe, result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const runRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await restorePremiumPurchases();
      if (!result.ok) {
        Alert.alert(LIVESTREAM_PAYWALL_COPY.restore, result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      accessible
      accessibilityLabel={`${LIVESTREAM_PAYWALL_COPY.title}. ${LIVESTREAM_PAYWALL_COPY.body}`}
      style={styles.card}
    >
      <Text style={styles.title}>{LIVESTREAM_PAYWALL_COPY.title}</Text>
      <Text style={styles.body}>{LIVESTREAM_PAYWALL_COPY.body}</Text>

      {iapOn ? (
        <>
          <Text style={styles.caption}>{LIVESTREAM_PAYWALL_COPY.plans}</Text>
          <Text style={styles.caption}>{LIVESTREAM_PAYWALL_COPY.autoRenew}</Text>
        </>
      ) : null}

      <View style={styles.actions}>
        <PrimaryButton
          disabled={busy}
          label={LIVESTREAM_PAYWALL_COPY.subscribe}
          onPress={() => void runPurchase()}
        />
        <PrimaryButton
          disabled={busy}
          label={LIVESTREAM_PAYWALL_COPY.notNow}
          onPress={() => onDismiss?.()}
          tone="muted"
        />
      </View>

      {iapOn ? (
        <View style={styles.iapExtras}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void runRestore()}
            style={styles.linkBtn}
          >
            <Text style={styles.link}>{LIVESTREAM_PAYWALL_COPY.restore}</Text>
          </Pressable>
          <View style={styles.legalRow}>
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(PREMIUM_LEGAL_URLS.terms)}
            >
              <Text style={styles.link}>{LIVESTREAM_PAYWALL_COPY.terms}</Text>
            </Pressable>
            <Text style={styles.legalSep}>·</Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(PREMIUM_LEGAL_URLS.privacy)}
            >
              <Text style={styles.link}>{LIVESTREAM_PAYWALL_COPY.privacy}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.lg, padding: space.md, gap: space.sm },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  caption: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  actions: { gap: space.sm, marginTop: space.xs },
  iapExtras: { gap: space.sm, marginTop: space.xs, alignItems: "center" },
  linkBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm },
  link: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  legalRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" },
  legalSep: { color: colors.muted, fontSize: 14 },
});
