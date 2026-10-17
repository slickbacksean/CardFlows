import { ACCOUNT_DELETION_COPY, isAccountDeletionConfirmed } from "@cardflow/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { deleteAccountEverywhere } from "@/lib/account-deletion";
import { isGuestSession } from "@/lib/identity";
import { colors, space } from "@/lib/theme";

/**
 * P4: in-app account deletion (Apple 5.1.1(v)). Says exactly what goes, asks the user to type
 * DELETE, confirms once more, then deletes on the server before wiping the phone.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const guest = isGuestSession();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const c = ACCOUNT_DELETION_COPY;
  const confirmed = isAccountDeletionConfirmed(typed);

  async function runDelete() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAccountEverywhere();
      setDone(true);
    } catch {
      // Server data untouched; never show the raw server text.
      setError(c.failed);
    } finally {
      setDeleting(false);
    }
  }

  function confirmDelete() {
    if (!confirmed || deleting) return;
    Alert.alert(c.alertTitle, c.alertBody, [
      { text: c.cancel, style: "cancel" },
      { text: c.confirmButton, style: "destructive", onPress: () => void runDelete() },
    ]);
  }

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title={c.title} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {done ? (
          <>
            <Text accessibilityLiveRegion="polite" accessibilityRole="header" style={styles.title}>
              {c.done}
            </Text>
            <PrimaryButton label="Done" onPress={() => router.replace("/")} />
          </>
        ) : (
          <>
            <Text style={styles.body}>{guest ? c.guestIntro : c.intro}</Text>
            {c.deletes.map((line) => (
              <Text key={line} style={styles.item}>
                {`• ${line}`}
              </Text>
            ))}
            <Text style={styles.body}>{c.keeps}</Text>
            <Text style={styles.label}>{c.confirmPrompt}</Text>
            <TextInput
              accessibilityLabel={c.confirmPrompt}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleting}
              onChangeText={setTyped}
              placeholder={c.confirmWord}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={typed}
            />
            {error ? (
              <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <PrimaryButton
              disabled={!confirmed || deleting}
              label={deleting ? c.deleting : c.confirmButton}
              onPress={confirmDelete}
              tone="danger"
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  title: { color: colors.text, fontSize: 18, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 15 },
  item: { color: colors.text, fontSize: 15 },
  label: { color: colors.text, fontSize: 15, fontWeight: "700" },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    paddingHorizontal: space.md,
    fontSize: 16,
  },
  error: { color: colors.danger, fontSize: 14 },
});
