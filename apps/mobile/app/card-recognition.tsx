import { CARDSIGHT_CONSENT_COPY, TRAINING_CAPTURE_COPY } from "@cardflow/shared";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { getCardSightConsent, getTrainingPreference, setTrainingPreference } from "@/lib/api";
import { ensureAccountAgeConfirmed } from "@/lib/age-confirmation";
import { saveCardSightConsent } from "@/lib/cardsight-consent";
import { colors, space } from "@/lib/theme";

/** Sean: turn CardSight on or off (withdraw consent). Off means PokeSniper's own matcher only. */
export default function CardRecognitionScreen() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Sean (Oct 21): keep confirmed Scan a Card photos to improve PokeSniper's own matcher. Default on (Terms).
  const [training, setTraining] = useState(true);
  const [trainingLoaded, setTrainingLoaded] = useState(false);
  const [trainingNote, setTrainingNote] = useState<string | null>(null);

  useEffect(() => {
    void getCardSightConsent()
      .then((res) => setEnabled(res.consent.granted))
      .catch(() => setNote("Couldn't load this setting. Check your connection."))
      .finally(() => setLoaded(true));
    void getTrainingPreference()
      .then((res) => {
        setTraining(res.training.enabled);
        setTrainingLoaded(true);
      })
      .catch(() => setTrainingNote("Couldn't load this setting. Check your connection."));
  }, []);

  async function toggleTraining(next: boolean) {
    setTraining(next);
    try {
      const res = await setTrainingPreference(next);
      setTraining(res.training.enabled);
      setTrainingNote(res.training.enabled ? TRAINING_CAPTURE_COPY.optedIn : TRAINING_CAPTURE_COPY.optedOut);
    } catch {
      setTraining(!next);
      setTrainingNote("Couldn't save. Try again.");
    }
  }

  async function toggle(next: boolean) {
    // CardSight is only for accounts that confirmed 18+.
    if (next && !(await ensureAccountAgeConfirmed())) return;
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
        <View style={styles.row}>
          <Text style={styles.label}>{TRAINING_CAPTURE_COPY.settingsLabel}</Text>
          <Switch
            accessibilityLabel={TRAINING_CAPTURE_COPY.settingsLabel}
            accessibilityRole="switch"
            disabled={!trainingLoaded}
            onValueChange={(next) => void toggleTraining(next)}
            value={training}
          />
        </View>
        <Text style={styles.body}>{TRAINING_CAPTURE_COPY.settingsHelp}</Text>
        {trainingNote ? <Text style={styles.body}>{trainingNote}</Text> : null}
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
