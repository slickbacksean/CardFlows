import { CRASH_REPORTS_COPY } from "@cardflow/shared";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { crashReportsEnabled, loadCrashReportsPreference, setCrashReportsEnabled } from "@/lib/sentry";
import { colors, space } from "@/lib/theme";

/**
 * Policy Reviewer (P4): Send crash reports. Off by default (opt-in); gates initMobileSentry, and turning it
 * off stops sending right away. Separate from Usage analytics (PostHog), which is opt-in.
 */
export default function CrashReportsScreen() {
  const [enabled, setEnabled] = useState(crashReportsEnabled());
  useEffect(() => {
    void loadCrashReportsPreference().then(setEnabled);
  }, []);
  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title={CRASH_REPORTS_COPY.label} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <Text style={styles.label}>{CRASH_REPORTS_COPY.label}</Text>
          <Switch
            accessibilityLabel={CRASH_REPORTS_COPY.label}
            accessibilityRole="switch"
            onValueChange={(next) => {
              setEnabled(next);
              void setCrashReportsEnabled(next);
            }}
            value={enabled}
          />
        </View>
        <Text style={styles.body}>{CRASH_REPORTS_COPY.note}</Text>
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
