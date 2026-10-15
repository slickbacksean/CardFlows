import {
  PRACTICE_COPY,
  PRACTICE_SAMPLE_CARDS,
  PRACTICE_STEPS,
  INITIAL_PRACTICE_STATE,
  isPracticeComplete,
  nextPracticeStep,
  practiceMaxBuy,
  practicePregradeLines,
  practiceProgressLabel,
  practiceReducer,
  practiceSampleCard,
  type PracticeAction,
  type PracticeState,
} from "@cardflow/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { loadPracticeProgress, savePracticeProgress } from "@/lib/practice-progress";
import { peekMaxBuyPreferences } from "@/lib/preferences";
import { colors, radii, space } from "@/lib/theme";

export default function PracticeScreen() {
  const [state, setState] = useState<PracticeState>(INITIAL_PRACTICE_STATE);
  const [showUndo, setShowUndo] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    void loadPracticeProgress().then((saved) => {
      loaded.current = true;
      setState(saved);
    });
  }, []);

  const dispatch = (action: PracticeAction) => {
    setState((prev) => {
      const next = practiceReducer(prev, action);
      if (loaded.current) void savePracticeProgress(next);
      return next;
    });
    setShowUndo(action.type === "purchase");
  };

  const card = practiceSampleCard(state.selectedCardId);
  const step = nextPracticeStep(state);
  const maxBuy = card ? practiceMaxBuy(card, peekMaxBuyPreferences()) : null;
  const pregrade = card ? practicePregradeLines(card) : null;
  const purchased = card ? state.practicePurchasedIds.includes(card.id) : false;

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title={PRACTICE_COPY.screenTitle} />
      <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
        <Text accessibilityRole="text" style={styles.banner}>{PRACTICE_COPY.banner}</Text>

        <Text accessibilityRole="header" style={styles.section}>
          {PRACTICE_COPY.checklistTitle} · {practiceProgressLabel(state)}
        </Text>
        {PRACTICE_STEPS.map((s) => {
          const done = state.completed.includes(s.id);
          const current = step === s.id;
          return (
            <View
              accessibilityLabel={`${s.title}. ${done ? "Done" : current ? "Next" : "Not started"}`}
              key={s.id}
              style={styles.stepRow}
            >
              <Ionicons
                color={done ? colors.success : current ? colors.accent : colors.muted}
                name={done ? "checkmark-circle" : current ? "arrow-forward-circle" : "ellipse-outline"}
                size={24}
              />
              <View style={styles.flex}>
                <Text style={styles.stepTitle}>{s.title}{done ? " · Done" : ""}</Text>
                <Text style={styles.body}>{s.hint}</Text>
              </View>
            </View>
          );
        })}

        <Text accessibilityRole="header" style={styles.section}>{PRACTICE_COPY.pickCard}</Text>
        {PRACTICE_SAMPLE_CARDS.map((sample) => (
          <Action
            key={sample.id}
            label={`${sample.name} · ${sample.setName} ${sample.number}${sample.id === card?.id ? " · Selected" : ""}`}
            onPress={() => dispatch({ type: "scan", cardId: sample.id })}
          />
        ))}

        {card ? (
          <View style={styles.panel}>
            <Text style={styles.stepTitle}>{PRACTICE_COPY.scanned(card.name)}</Text>
            <Text style={styles.body}>
              {PRACTICE_COPY.referenceLabel}: ${card.referencePriceAmount} · {card.condition}
            </Text>
            <Action label="Check Max Buy" onPress={() => dispatch({ type: "view_max_buy" })} />
            {state.completed.includes("max_buy") && maxBuy ? (
              <>
                <Text style={styles.value}>{maxBuy.display}</Text>
                <Text style={styles.body}>{maxBuy.disclaimer}</Text>
                <Action
                  disabled={purchased}
                  label={purchased ? "Purchased (practice)" : "Mark Purchased"}
                  onPress={() => dispatch({ type: "purchase" })}
                />
                {showUndo && purchased ? (
                  <Action label={`${PRACTICE_COPY.purchasedToast}`} onPress={() => dispatch({ type: "undo_purchase" })} />
                ) : null}
              </>
            ) : null}
            {state.completed.includes("purchased") && pregrade ? (
              <>
                <Action label="Try a pre-grade estimate" onPress={() => dispatch({ type: "pregrade" })} />
                {state.completed.includes("pregrade") ? (
                  <>
                    <Text style={styles.stepTitle}>{pregrade.title}</Text>
                    <Text style={styles.value}>{pregrade.value}</Text>
                    <Text style={styles.body}>{pregrade.disclaimer}</Text>
                  </>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}

        {isPracticeComplete(state) ? <Text style={styles.done}>{PRACTICE_COPY.done}</Text> : null}
        <Action label={PRACTICE_COPY.reset} onPress={() => dispatch({ type: "reset" })} />
      </ScrollView>
    </View>
  );
}

function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, disabled && styles.actionDisabled]}
    >
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: 48, gap: space.sm },
  banner: { color: colors.accentText, backgroundColor: colors.accent, padding: space.sm, borderRadius: radii.sm, fontWeight: "700" },
  section: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: space.md },
  stepRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-start", minHeight: 44 },
  stepTitle: { color: colors.text, fontWeight: "700" },
  body: { color: colors.muted },
  value: { color: colors.text, fontSize: 18, fontWeight: "800" },
  panel: { backgroundColor: colors.card, borderRadius: radii.md, padding: space.md, gap: space.sm },
  action: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radii.md, backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.cardBorder },
  actionDisabled: { opacity: 0.6 },
  actionLabel: { color: colors.text, fontWeight: "600" },
  done: { color: colors.success, fontWeight: "700" },
});
