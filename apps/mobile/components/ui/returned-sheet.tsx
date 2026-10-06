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

export interface ReturnedSheetPayload {
  certNumber: string;
  returnedGrade: string;
}

export interface ReturnedSheetProps {
  visible: boolean;
  mode: "mark" | "edit";
  name: string;
  localId: string | null;
  imageUrl: string | null;
  seedCertNumber: string;
  seedReturnedGrade: string;
  onClose: () => void;
  onSave: (payload: ReturnedSheetPayload) => void;
}

export function ReturnedSheet(props: ReturnedSheetProps) {
  return (
    <ReturnedSheetForm
      key={
        props.visible
          ? `open:${props.mode}:${props.seedCertNumber}:${props.seedReturnedGrade}`
          : "closed"
      }
      {...props}
    />
  );
}

function ReturnedSheetForm({
  visible,
  mode,
  name,
  localId,
  imageUrl,
  seedCertNumber,
  seedReturnedGrade,
  onClose,
  onSave,
}: ReturnedSheetProps) {
  const [certNumber, setCertNumber] = useState(seedCertNumber);
  const [returnedGrade, setReturnedGrade] = useState(seedReturnedGrade);

  function save() {
    onSave({ certNumber, returnedGrade });
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
            accessibilityLabel="Dismiss returned sheet"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.dismiss}
          />
          <SafeAreaView edges={["bottom"]} style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Returned</Text>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.heroWrap}>
                {imageUrl ? (
                  <Image
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={`${name} catalog art`}
                    contentFit="contain"
                    source={{ uri: imageUrl }}
                    style={styles.hero}
                  />
                ) : (
                  <View
                    accessibilityLabel={`${name} catalog art`}
                    style={[styles.hero, styles.heroFallback]}
                  />
                )}
              </View>
              <Text style={styles.cardLine}>{localId ? `${name} #${localId}` : name}</Text>
              <Text style={styles.body}>
                You type the cert # and returned grade. CardFlow does not look them up.
              </Text>

              <Text style={styles.label}>Cert #</Text>
              <TextInput
                accessibilityLabel="Cert number"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setCertNumber}
                placeholder="Your cert #"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={certNumber}
              />

              <Text style={styles.label}>Returned condition / grade</Text>
              <TextInput
                accessibilityLabel="Returned condition or grade"
                onChangeText={setReturnedGrade}
                placeholder="You type this"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={returnedGrade}
              />
              <Text style={styles.body}>Not a PSA score. No certificate file.</Text>

              <PrimaryButton
                label={mode === "mark" ? "Mark returned" : "Save"}
                onPress={save}
              />
            </ScrollView>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
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
});
