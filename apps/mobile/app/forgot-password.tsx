import { ACCOUNT_AUTH_COPY, isValidEmail } from "@cardflow/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { requestPasswordReset } from "@/lib/api";
import { colors } from "@/lib/theme";
import { authStyles as styles } from "@/components/ui/auth-styles";

/** Forgot password, step 1: ask for a reset code. Same answer for every email (no enumeration). */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!isValidEmail(email)) return setError(ACCOUNT_AUTH_COPY.badEmail);
    setSaving(true);
    setError(null);
    try {
      const res = await requestPasswordReset(email.trim());
      setSent(res.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ACCOUNT_AUTH_COPY.tooMany);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title="Forgot password" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.body}>Enter your account email and we&apos;ll send you a reset code.</Text>
        <TextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          inputMode="email"
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={colors.muted}
          style={styles.input}
          textContentType="emailAddress"
          value={email}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {sent ? <Text style={styles.body}>{sent}</Text> : null}
        <PrimaryButton disabled={saving} label="Send reset code" onPress={() => void submit()} />
        <Pressable accessibilityRole="button" onPress={() => router.push("/reset-password")}>
          <Text style={styles.link}>I have a reset code</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
