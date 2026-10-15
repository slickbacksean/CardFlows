import {
  DEFAULT_MAX_BUY_PREFERENCES,
  LOCKED_DISPLAY_CURRENCY,
  MAX_BUY_FEES_BUFFER_INVALID_MESSAGE,
  CONDITION_PRESET_LABELS,
  CONDITION_PRESETS_HELP,
  CONDITION_PRESETS_SECTION_LABEL,
  CONDITION_PRESETS_SUGGESTED_LABEL,
  conditionPresetsToForm,
  parseConditionPresetsForm,
  suggestedConditionPresetsForm,
  type ConditionPresetForm,
  MAX_BUY_MARGIN_INVALID_MESSAGE,
  MAX_BUY_MARGIN_MAX_PCT,
  MAX_BUY_FEES_MAX_PCT,
  MAX_BUY_RESET_NOT_SAVED_NOTICE,
  maxBuyPreferencesToFormValues,
  parseMaxBuyRulesForm,
  type MaxBuyPreferences,
} from "@cardflow/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { loadMaxBuyPreferences, peekMaxBuyPreferences, saveMaxBuyPreferences } from "@/lib/preferences";
import { colors, space } from "@/lib/theme";

export default function MaxBuyRulesScreen() {
  const initial = maxBuyPreferencesToFormValues(peekMaxBuyPreferences());
  const [targetMargin, setTargetMargin] = useState(initial.targetMarginDisplay);
  const [feesBuffer, setFeesBuffer] = useState(initial.feesBufferDisplay);
  const [presets, setPresets] = useState<ConditionPresetForm>(() =>
    conditionPresetsToForm(peekMaxBuyPreferences().conditionAdjustments),
  );
  const [existingAdjustments, setExistingAdjustments] = useState<
    Record<string, number> | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const applyPreferences = useCallback((preferences: MaxBuyPreferences) => {
    const values = maxBuyPreferencesToFormValues(preferences);
    setTargetMargin(values.targetMarginDisplay);
    setFeesBuffer(values.feesBufferDisplay);
    setPresets(conditionPresetsToForm(preferences.conditionAdjustments));
    setExistingAdjustments(
      preferences.conditionAdjustments
        ? { ...preferences.conditionAdjustments }
        : null,
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      applyPreferences(peekMaxBuyPreferences());
      setNotice(null);
      let cancelled = false;
      void loadMaxBuyPreferences()
        .then((preferences) => {
          if (cancelled) return;
          applyPreferences(preferences);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          applyPreferences(peekMaxBuyPreferences());
          setError(caught instanceof Error ? caught.message : "Could not load rules");
        });
      return () => {
        cancelled = true;
      };
    }, [applyPreferences]),
  );

  function onResetDefaults() {
    applyPreferences(DEFAULT_MAX_BUY_PREFERENCES);
    setError(null);
    setNotice(MAX_BUY_RESET_NOT_SAVED_NOTICE);
  }

  async function onSave() {
    const parsed = parseMaxBuyRulesForm({
      targetMarginDisplay: targetMargin,
      feesBufferDisplay: feesBuffer,
      conditionFactorNmDisplay: "1",
      existingAdjustments,
    });
    if (!parsed.ok) {
      setNotice(null);
      setError(parsed.error);
      return;
    }
    const conditions = parseConditionPresetsForm(presets, existingAdjustments);
    if (!conditions.ok) {
      setNotice(null);
      setError(conditions.error);
      return;
    }
    parsed.preferences.conditionAdjustments = conditions.conditionAdjustments;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveMaxBuyPreferences(parsed.preferences);
      applyPreferences(saved);
      setNotice("Rules saved. Max Buy guidance will recompute on saved cards.");
    } catch (caught) {
      setNotice(null);
      setError(caught instanceof Error ? caught.message : "Could not save rules");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title="Max Buy rules" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          style={styles.flex}
        >
        <Text style={styles.formula}>
          {"reference x (1 - margin)\n          x (1 - fees)\n          x condition factor"}
        </Text>

        {error === MAX_BUY_MARGIN_INVALID_MESSAGE ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {MAX_BUY_MARGIN_INVALID_MESSAGE}
          </Text>
        ) : null}
        <RuleRow
          helper={`0–${MAX_BUY_MARGIN_MAX_PCT}%, default 20%`}
          label="Target margin"
          onChangeText={setTargetMargin}
          suffix="%"
          value={targetMargin}
        />
        {error === MAX_BUY_FEES_BUFFER_INVALID_MESSAGE ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {MAX_BUY_FEES_BUFFER_INVALID_MESSAGE}
          </Text>
        ) : null}
        <RuleRow
          accessibilityLabel="Fees buffer"
          helper={`0–${MAX_BUY_FEES_MAX_PCT}%, default 13%`}
          label="Fees buffer"
          onChangeText={setFeesBuffer}
          suffix="%"
          value={feesBuffer}
        />
        <View style={styles.row}>
          <Text style={styles.label}>Currency</Text>
          <Text accessibilityLabel={`Currency ${LOCKED_DISPLAY_CURRENCY}`} style={styles.currency}>
            {LOCKED_DISPLAY_CURRENCY}
          </Text>
        </View>

        <Text style={styles.section}>{CONDITION_PRESETS_SECTION_LABEL}</Text>
        <Text style={styles.body}>{CONDITION_PRESETS_HELP}</Text>
        {CONDITION_PRESET_LABELS.map((label) => (
          <RuleRow
            accessibilityLabel={`${label} condition percent`}
            key={label}
            label={label}
            onChangeText={(value) => setPresets((current) => ({ ...current, [label]: value }))}
            suffix="%"
            value={presets[label]}
          />
        ))}
        <PrimaryButton
          disabled={isSaving}
          label={CONDITION_PRESETS_SUGGESTED_LABEL}
          onPress={() => {
            setPresets(suggestedConditionPresetsForm());
            setError(null);
            setNotice(MAX_BUY_RESET_NOT_SAVED_NOTICE);
          }}
          tone="muted"
        />

        <Text style={styles.body}>
          Changing these updates Max Buy guidance on saved cards. It is not a
          market price.
        </Text>
        {error &&
        error !== MAX_BUY_MARGIN_INVALID_MESSAGE &&
        error !== MAX_BUY_FEES_BUFFER_INVALID_MESSAGE ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <PrimaryButton disabled={isSaving} label="Save rules" onPress={() => void onSave()} />
        <PrimaryButton
          disabled={isSaving}
          label="Reset defaults"
          onPress={onResetDefaults}
          tone="muted"
        />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

interface RuleRowProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  suffix?: string;
  helper?: string;
  accessibilityLabel?: string;
}

function RuleRow({
  label,
  value,
  onChangeText,
  suffix,
  helper,
  accessibilityLabel,
}: RuleRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.labelBlock}>
        <Text style={styles.label}>{label}</Text>
        {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      </View>
      <View style={styles.inputWrap}>
        <TextInput
          accessibilityLabel={accessibilityLabel ?? label}
          keyboardType="decimal-pad"
          onChangeText={onChangeText}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={value}
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: space.lg,
    paddingBottom: 48,
    gap: space.md,
  },
  formula: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
    fontVariant: ["tabular-nums"],
  },
  section: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  labelBlock: { flex: 1, gap: 2 },
  label: { color: colors.text, fontSize: 16, fontWeight: "700" },
  helper: { color: colors.muted, fontSize: 13 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  input: {
    minWidth: 72,
    backgroundColor: colors.chip,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "right",
  },
  suffix: { color: colors.muted, fontSize: 16, fontWeight: "700", width: 18 },
  currency: { color: colors.text, fontSize: 16, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 15, lineHeight: 22 },
  notice: { color: colors.success, fontSize: 15, lineHeight: 22 },
});
