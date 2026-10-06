import { computeAllInCost, parseDollarsToCents, LOCKED_DISPLAY_CURRENCY } from "@cardflow/shared";
import type { TcgdexVariants } from "@cardflow/shared";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { defaultVariantId, variantOptions } from "@/lib/variants";
import { colors, space } from "@/lib/theme";
import { PrimaryButton } from "./primary-button";

const PURCHASE_CONDITIONS = ["NM", "LP", "MP"] as const;

export interface PurchaseSavePayload {
  purchasePrice: string;
  purchasedAt: string;
  currency: typeof LOCKED_DISPLAY_CURRENCY;
  shipping?: string;
  tax?: string;
  fees?: string;
  supplies?: string;
  condition: string;
  selectedVariant: string;
}

export interface PurchaseSheetProps {
  visible: boolean;
  name: string;
  setName: string;
  localId: string;
  variants: TcgdexVariants;
  selectedVariant?: string | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: PurchaseSavePayload) => void;
}

export function PurchaseSheet(props: PurchaseSheetProps) {
  const variantKey = props.selectedVariant ?? defaultVariantId(props.variants, props.selectedVariant);
  return (
    <PurchaseSheetForm
      key={props.visible ? `open:${variantKey}` : "closed"}
      {...props}
    />
  );
}

function PurchaseSheetForm({
  visible,
  name,
  setName,
  localId,
  variants,
  selectedVariant,
  isSaving,
  error,
  onClose,
  onSave,
}: PurchaseSheetProps) {
  const options = variantOptions(variants);
  const [purchasePrice, setPurchasePrice] = useState("");
  const [shipping, setShipping] = useState("0.00");
  const [tax, setTax] = useState("0.00");
  const [fees, setFees] = useState("0.00");
  const [supplies, setSupplies] = useState("0.00");
  const [condition, setCondition] = useState<(typeof PURCHASE_CONDITIONS)[number]>("NM");
  const [variantId, setVariantId] = useState(() =>
    defaultVariantId(variants, selectedVariant),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const allInDisplay = useMemo(
    () => formatAllIn(purchasePrice, shipping, tax, fees, supplies),
    [fees, purchasePrice, shipping, supplies, tax],
  );

  const shownError = localError ?? error;

  function submit() {
    const trimmedPrice = purchasePrice.trim();
    if (!trimmedPrice) {
      setLocalError("Purchase price is required.");
      return;
    }
    if (!isValidDollarAmount(trimmedPrice)) {
      setLocalError("Enter a valid purchase price.");
      return;
    }
    const optional = {
      shipping: optionalAmount(shipping),
      tax: optionalAmount(tax),
      fees: optionalAmount(fees),
      supplies: optionalAmount(supplies),
    };
    if (Object.values(optional).some((line) => line === "invalid")) {
      setLocalError("Optional cost lines must be valid amounts.");
      return;
    }
    setLocalError(null);
    onSave({
      purchasePrice: trimmedPrice,
      purchasedAt: new Date().toISOString(),
      currency: LOCKED_DISPLAY_CURRENCY,
      shipping: optional.shipping === "empty" ? undefined : optional.shipping,
      tax: optional.tax === "empty" ? undefined : optional.tax,
      fees: optional.fees === "empty" ? undefined : optional.fees,
      supplies: optional.supplies === "empty" ? undefined : optional.supplies,
      condition,
      selectedVariant: variantId,
    });
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.backdrop}>
          <Pressable
            accessibilityLabel="Dismiss purchase sheet"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.dismiss}
          />
          <SafeAreaView edges={["bottom"]} style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Save purchased</Text>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.cardLine}>
                {name} · {setName} #{localId}
              </Text>

              <FieldRow
                accessibilityLabel="Purchase price"
                invalid={shownError === "Purchase price is required."}
                keyboardType="decimal-pad"
                label="Purchase price *"
                onChangeText={(value) => {
                  setPurchasePrice(value);
                  if (localError) setLocalError(null);
                }}
                placeholder="0.00"
                value={purchasePrice}
              />
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Purchased at</Text>
                <Text style={styles.rowValue}>now</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Currency</Text>
                <Text style={styles.rowValue}>{LOCKED_DISPLAY_CURRENCY}</Text>
              </View>

              <Text style={styles.section}>Optional (default 0)</Text>
              <FieldRow
                accessibilityLabel="Shipping"
                keyboardType="decimal-pad"
                label="Shipping"
                onChangeText={setShipping}
                value={shipping}
              />
              <FieldRow
                accessibilityLabel="Tax"
                keyboardType="decimal-pad"
                label="Tax"
                onChangeText={setTax}
                value={tax}
              />
              <FieldRow
                accessibilityLabel="Fees"
                keyboardType="decimal-pad"
                label="Fees"
                onChangeText={setFees}
                value={fees}
              />
              <FieldRow
                accessibilityLabel="Supplies"
                keyboardType="decimal-pad"
                label="Supplies"
                onChangeText={setSupplies}
                value={supplies}
              />

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>All-in total</Text>
                <Text style={styles.totalValue}>{allInDisplay}</Text>
              </View>

              <Text style={styles.label}>Condition</Text>
              <View style={styles.chips}>
                {PURCHASE_CONDITIONS.map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    onPress={() => setCondition(value)}
                    selected={condition === value}
                  />
                ))}
              </View>

              <Text style={styles.label}>Variant</Text>
              <View style={styles.chips}>
                {options.map((option) => (
                  <Chip
                    key={option.id}
                    label={option.label}
                    onPress={() => setVariantId(option.id)}
                    selected={variantId === option.id}
                  />
                ))}
              </View>

              {shownError ? <Text style={styles.error}>{shownError}</Text> : null}

              <PrimaryButton
                disabled={isSaving}
                label={isSaving ? "Saving…" : "Save purchased"}
                onPress={submit}
              />
            </ScrollView>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface FieldRowProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  accessibilityLabel: string;
  placeholder?: string;
  keyboardType?: "decimal-pad";
  invalid?: boolean;
}

function FieldRow({
  label,
  value,
  onChangeText,
  accessibilityLabel,
  placeholder,
  keyboardType,
  invalid,
}: FieldRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.rowInput, invalid && styles.rowInputInvalid]}
        value={value}
      />
    </View>
  );
}

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

function isValidDollarAmount(value: string): boolean {
  return parseDollarsToCents(value) !== null;
}

function optionalAmount(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  return isValidDollarAmount(trimmed) ? trimmed : "invalid";
}

function formatAllIn(
  purchasePrice: string,
  shipping: string,
  tax: string,
  fees: string,
  supplies: string,
): string {
  const price = purchasePrice.trim() || "0";
  if (!isValidDollarAmount(price)) return "—";
  const lines = [shipping, tax, fees, supplies].map((line) => line.trim() || "0");
  if (lines.some((line) => !isValidDollarAmount(line))) return "—";
  try {
    const result = computeAllInCost({
      purchasePrice: price,
      shipping: lines[0],
      tax: lines[1],
      fees: lines[2],
      supplies: lines[3],
    });
    return `$${result.allInTotal}`;
  } catch {
    return "—";
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
    maxHeight: "92%",
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
  title: { color: colors.text, fontSize: 22, fontWeight: "800", marginBottom: space.sm },
  content: { gap: space.md, paddingBottom: space.sm },
  cardLine: { color: colors.text, fontSize: 16, fontWeight: "700" },
  section: { color: colors.muted, fontWeight: "700", fontSize: 13, letterSpacing: 0.2 },
  label: { color: colors.text, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  rowLabel: { color: colors.text, fontWeight: "700", flex: 1 },
  rowValue: { color: colors.text, fontSize: 16, fontWeight: "600" },
  rowInput: {
    width: 120,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: space.sm,
    paddingVertical: 10,
    fontSize: 16,
    textAlign: "right",
  },
  rowInputInvalid: { borderColor: colors.danger },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  totalLabel: { color: colors.text, fontWeight: "700" },
  totalValue: { color: colors.success, fontSize: 18, fontWeight: "800" },
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
