import {
  GRADE_ESTIMATE_DISCLAIMER,
  GRADE_ESTIMATE_EMPTY_COPY,
  GRADE_ESTIMATE_GUIDANCE_HISTORY_LABEL,
  SUBMITTED_STATUSES,
  confidenceLabel,
  parseStoredGradeEstimate,
  submittedStatusLabel,
  type GradingSubmittedCopy,
  type SubmittedStatus,
} from "@cardflow/shared";
import { Image } from "expo-image";
import { useState } from "react";
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
import { colors, space } from "@/lib/theme";
import { PrimaryButton } from "./primary-button";

export interface SubmittedSheetSavePayload {
  orderNumber: string;
  company: string;
  status: SubmittedStatus;
}

export interface SubmittedSheetProps {
  visible: boolean;
  copy: GradingSubmittedCopy | null;
  onClose: () => void;
  onSave: (payload: SubmittedSheetSavePayload) => void;
  onMarkReturned: (payload: SubmittedSheetSavePayload) => void;
}

export function SubmittedSheet(props: SubmittedSheetProps) {
  const copyKey = props.copy
    ? `${props.copy.inventoryItemId}:${props.copy.orderNumber}:${props.copy.company}:${props.copy.status}`
    : "empty";
  return (
    <SubmittedSheetForm key={props.visible ? `open:${copyKey}` : "closed"} {...props} />
  );
}

function SubmittedSheetForm({
  visible,
  copy,
  onClose,
  onSave,
  onMarkReturned,
}: SubmittedSheetProps) {
  const [orderNumber, setOrderNumber] = useState(copy?.orderNumber ?? "");
  const [company, setCompany] = useState(copy?.company ?? "");
  const [status, setStatus] = useState<SubmittedStatus>(copy?.status ?? "sent");

  const name = copy?.name ?? "Card";
  const estimate = parseStoredGradeEstimate(copy?.estimateJson);
  const confidence = confidenceLabel(estimate?.confidence ?? null);

  function save() {
    onSave({ orderNumber, company, status });
  }

  function markReturned() {
    onMarkReturned({ orderNumber, company, status });
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
            accessibilityLabel="Dismiss submitted sheet"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.dismiss}
          />
          <SafeAreaView edges={["bottom"]} style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Submitted</Text>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.heroWrap}>
                {copy?.imageUrl ? (
                  <Image
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={`${name} catalog art`}
                    contentFit="contain"
                    source={{ uri: copy.imageUrl }}
                    style={styles.hero}
                  />
                ) : (
                  <View
                    accessibilityLabel={`${name} catalog art`}
                    style={[styles.hero, styles.heroFallback]}
                  />
                )}
              </View>
              <Text style={styles.cardLine}>
                {copy?.localId ? `${name} #${copy.localId}` : name}
              </Text>

              <View style={styles.guidance}>
                <Text style={styles.section}>{GRADE_ESTIMATE_GUIDANCE_HISTORY_LABEL}</Text>
                <Text style={styles.caption}>{GRADE_ESTIMATE_DISCLAIMER}</Text>
                {!estimate || estimate.overall == null ? (
                  <Text style={styles.body}>{GRADE_ESTIMATE_EMPTY_COPY}</Text>
                ) : (
                  <>
                    <Text style={styles.estimateOverall}>{estimate.display}</Text>
                    {confidence ? <Text style={styles.rowMeta}>{confidence}</Text> : null}
                  </>
                )}
              </View>

              <Text style={styles.body}>You set this. CardFlow does not track the order.</Text>

              <Text style={styles.label}>Order #</Text>
              <TextInput
                accessibilityLabel="Order number"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setOrderNumber}
                placeholder="Your order #"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={orderNumber}
              />

              <Text style={styles.label}>Company</Text>
              <TextInput
                accessibilityLabel="Company"
                onChangeText={setCompany}
                placeholder="PSA"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={company}
              />

              <Text style={styles.label}>Status</Text>
              <View style={styles.chips}>
                {SUBMITTED_STATUSES.map((value) => (
                  <Chip
                    key={value}
                    label={submittedStatusLabel(value)}
                    onPress={() => setStatus(value)}
                    selected={status === value}
                  />
                ))}
              </View>

              <PrimaryButton label="Save" onPress={save} />
              <PrimaryButton label="Mark returned" onPress={markReturned} tone="muted" />
            </ScrollView>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  heroWrap: { alignItems: "center" },
  hero: {
    width: 188,
    aspectRatio: 0.715,
    borderRadius: 16,
    backgroundColor: colors.chip,
  },
  heroFallback: { borderWidth: 1, borderColor: colors.cardBorder },
  cardLine: { color: colors.text, fontSize: 16, fontWeight: "700", textAlign: "center" },
  section: { color: colors.muted, fontWeight: "700", fontSize: 13, letterSpacing: 0.2 },
  caption: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  guidance: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: space.sm,
  },
  estimateOverall: { color: colors.text, fontSize: 20, fontWeight: "800" },
  rowMeta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  label: { color: colors.text, fontWeight: "700" },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: {
    backgroundColor: colors.chip,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: "#2A2618" },
  chipLabel: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  chipLabelSelected: { color: colors.accent },
});
