import { RECOGNITION_SCENARIOS, type RecognitionScenario } from "@cardflow/shared";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getMockScenario, setMockScenario } from "@/lib/mock-scenario";
import { colors, space } from "@/lib/theme";

const SCENARIO_LABELS: Record<RecognitionScenario, string> = {
  "high-confidence": "High",
  ambiguous: "Ambiguous",
  "no-card": "No card",
  error: "Timeout",
  "rate-limit": "Rate limit",
  "no-match": "No match",
};

export function DevScenarioPanel() {
  const [scenario, setScenario] = useState(getMockScenario);

  if (!__DEV__) return null;

  function select(value: RecognitionScenario) {
    setMockScenario(value);
    setScenario(value);
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.kicker}>DEV  Mock scenario</Text>
      <Text style={styles.hint}>Used by the next mock scan. Not product UI.</Text>
      <View style={styles.chips}>
        {RECOGNITION_SCENARIOS.map((value) => {
          const selected = value === scenario;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => select(value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                {SCENARIO_LABELS[value]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: space.md,
    gap: space.sm,
  },
  kicker: {
    color: colors.accent,
    fontWeight: "700",
    letterSpacing: 0.6,
    fontSize: 13,
  },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: {
    backgroundColor: colors.chip,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: "#2A2614" },
  chipLabel: { color: colors.muted, fontWeight: "600", fontSize: 13 },
  chipLabelSelected: { color: colors.accent },
});
