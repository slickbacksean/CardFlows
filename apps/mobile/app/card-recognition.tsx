import { CARDSIGHT_CONSENT_COPY } from "@cardflow/shared";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { getCardSightConsent } from "@/lib/api";
import { saveCardSightConsent } from "@/lib/cardsight-consent";
import { colors, space } from "@/lib/theme";

/** Sean: turn CardSight on or off (withdraw consent). Off means CardFlow's own matcher only. */
export default function CardRecognitionScreen() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void getCardSightConsent()
      .then((res) => setEnabled(res.consent.granted))
      .catch(() => setNote("Couldn't load this setting. Check your connection."))
      .finally(() => setLoaded(true));
  }, []);

  async function toggle(next: boolean) {
    setEnabled(next);
    const state = await saveCardSightConsent(next);
    if (!state) {
      setEnabled(!next);
      setNote("Couldn't save. Try again.");
      return;
    }
    setEnabled(state.granted);
    setNote(state.granted ? null : CARDSIGHT_CONSENT_COPY.withdrawn);
  }

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title="Card recognition" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <Text style={styles.label}>{CARDSIGHT_CONSENT_COPY.settingsLabel}</Text>
          <Switch
            accessibilityLabel={CARDSIGHT_CONSENT_COPY.settingsLabel}
            accessibilityRole="switch"
            disabled={!loaded}
            onValueChange={(next) => void toggle(next)}
            value={enabled}
          />
        </View>
        <Text style={styles.body}>{CARDSIGHT_CONSENT_COPY.settingsHelp}</Text>
        {note ? <Text style={styles.body}>{note}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: space.md },
  label: { color: colors.text, fontSize: 16, fontWeight: "600", flexShrink: 1 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});
