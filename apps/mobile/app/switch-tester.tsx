import {
  ACCOUNT_SWITCH_CONFIRM_ACTION,
  ACCOUNT_SWITCH_CONFIRM_MESSAGE,
  ACCOUNT_SWITCH_CONFIRM_TITLE,
  ACCOUNT_SWITCH_STAY_ACTION,
  shouldConfirmAccountSwitch,
} from "@cardflow/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { currentInventoryCount, loadActiveIdentity, switchActiveIdentity } from "@/lib/identity";
import { colors, space } from "@/lib/theme";

export default function SwitchTesterScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function redeem(inviteCode: string) {
    setIsSaving(true);
    setError(null);
    try {
      await switchActiveIdentity(inviteCode);
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown invite code.");
    } finally {
      setIsSaving(false);
    }
  }

  async function submit() {
    const inviteCode = code.trim();
    if (!inviteCode) {
      setError("Enter your invite code.");
      return;
    }
    const current = await loadActiveIdentity();
    let count: number | null = 0;
    try {
      count = await currentInventoryCount();
    } catch {
      count = null;
    }
    if (
      shouldConfirmAccountSwitch({
        currentUserId: current?.userId ?? null,
        nextUserId: "other",
        currentInventoryCount: count,
      })
    ) {
      Alert.alert(ACCOUNT_SWITCH_CONFIRM_TITLE, ACCOUNT_SWITCH_CONFIRM_MESSAGE, [
        { text: ACCOUNT_SWITCH_STAY_ACTION, style: "cancel" },
        { text: ACCOUNT_SWITCH_CONFIRM_ACTION, onPress: () => void redeem(inviteCode) },
      ]);
      return;
    }
    await redeem(inviteCode);
  }

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title="Invite code" />
      <SafeAreaView edges={["bottom"]} style={styles.content}>
        <Text style={styles.body}>Enter the invite code for the tester you want to use.</Text>
        <TextInput
          accessibilityLabel="Invite code"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setCode}
          placeholder="Invite code"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={code}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton disabled={isSaving} label="Continue" onPress={() => void submit()} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  body: { color: colors.muted, fontSize: 16, lineHeight: 22 },
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
  error: { color: colors.danger, fontSize: 14 },
});
