import { PRODUCT_ANALYTICS_LABEL, PRODUCT_ANALYTICS_NOTE } from "@cardflow/shared";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { loadAnalyticsPreference, setAnalyticsEnabled } from "@/lib/product-events";
import { colors, space } from "@/lib/theme";

/** P1-19: opt-in for privacy-safe usage events. Off by default; turning it off stops all events. */
export default function AnalyticsScreen() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    void loadAnalyticsPreference().then(setEnabled);
  }, []);
  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title="Usage analytics" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <Text style={styles.label}>{PRODUCT_ANALYTICS_LABEL}</Text>
          <Switch
            accessibilityLabel={PRODUCT_ANALYTICS_LABEL}
            accessibilityRole="switch"
            onValueChange={(next) => {
              setEnabled(next);
              void setAnalyticsEnabled(next);
            }}
            value={enabled}
          />
        </View>
        <Text style={styles.body}>{PRODUCT_ANALYTICS_NOTE}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  label: { color: colors.text, fontSize: 16, fontWeight: "600" },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});
