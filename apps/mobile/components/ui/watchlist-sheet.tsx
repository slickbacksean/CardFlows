import type { TcgdexVariants } from "@cardflow/shared";
import { CONDITION_LABELS } from "@cardflow/shared";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, space } from "@/lib/theme";
import { defaultVariantId, variantOptions } from "@/lib/variants";
import { PrimaryButton } from "./primary-button";

export interface WatchlistSheetProps {
  visible: boolean;
  name: string;
  setName: string;
  localId: string;
  variants: TcgdexVariants;
  selectedVariant?: string | null;
  reference: string;
  onChangeReference: (value: string) => void;
  maxBuyAmount: string | null;
  hasReference: boolean;
  disclaimer: string;
  rulesLine: string;
  condition: string;
  onChangeCondition: (condition: (typeof CONDITION_LABELS)[number]) => void;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (selectedVariant: string) => void;
}

export function WatchlistSheet(props: WatchlistSheetProps) {
  const variantKey = props.selectedVariant ?? defaultVariantId(props.variants, props.selectedVariant);
  return (
    <WatchlistSheetForm
      key={props.visible ? `open:${variantKey}` : "closed"}
      {...props}
    />
  );
}

function WatchlistSheetForm({
  visible,
  name,
  setName,
  localId,
  variants,
  selectedVariant,
  reference,
  onChangeReference,
  maxBuyAmount,
  hasReference,
  disclaimer,
  rulesLine,
  condition,
  onChangeCondition,
  isSaving,
  error,
  onClose,
  onSave,
}: WatchlistSheetProps) {
  const options = variantOptions(variants);
  const [variantId, setVariantId] = useState(() =>
    defaultVariantId(variants, selectedVariant),
  );

  const targetLine = maxBuyAmount
    ? `Target Max Buy $${maxBuyAmount} (guidance)`
    : "Target Max Buy (guidance)";

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Dismiss watchlist sheet"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.dismiss}
        />
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Save watchlist</Text>
          <Text style={styles.cardLine}>
            {name} · {setName} #{localId}
          </Text>
          <Text style={styles.body}>Not owned. No cost basis.</Text>
          <Text style={styles.body}>Cannot create a listing draft.</Text>

          <Text style={styles.label}>Reference (USD, you typed)</Text>
          <TextInput
            accessibilityLabel="Reference price"
            keyboardType="decimal-pad"
            onChangeText={onChangeReference}
            placeholder="e.g. 8.00"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={reference}
          />
          {hasReference ? (
            <View style={styles.guidance}>
              <Text style={styles.guidanceValue}>{targetLine}</Text>
              <Text style={styles.body}>{rulesLine}</Text>
              <Text style={styles.body}>{disclaimer}</Text>
            </View>
          ) : (
            <Text style={styles.body}>Enter a reference price to compute Max Buy.</Text>
          )}

          <Text style={styles.label}>Condition</Text>
          <View accessibilityRole="radiogroup" style={styles.chips}>
            {CONDITION_LABELS.map((label) => {
              const selected = label === condition;
              return (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onChangeCondition(label)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Variant</Text>
          <View style={styles.chips}>
            {options.map((option) => {
              const selected = option.id === variantId;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setVariantId(option.id)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <PrimaryButton
            disabled={isSaving}
            label={isSaving ? "Saving…" : "Save to watchlist"}
            onPress={() => onSave(variantId)}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.muted,
    marginBottom: space.xs,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  cardLine: { color: colors.text, fontSize: 16, fontWeight: "700" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  label: { color: colors.text, fontWeight: "700", marginTop: space.xs },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 18,
  },
  guidance: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: space.md,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginTop: space.xs,
  },
  guidanceValue: { color: colors.success, fontSize: 16, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: {
    backgroundColor: colors.chip,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.card },
  chipLabel: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  chipLabelSelected: { color: colors.text },
  error: { color: colors.danger, fontSize: 14 },
});
