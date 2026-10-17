import { ACCOUNT_AUTH_COPY, PASSWORD_MIN_LENGTH, passwordProblem } from "@cardflow/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { confirmPasswordReset } from "@/lib/api";
import { colors } from "@/lib/theme";
import { authStyles as styles } from "@/components/ui/auth-styles";

/** Forgot password, step 2: the single-use code (1 hour) and a new password. */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(typeof params.token === "string" ? params.token : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (!token.trim()) return setError(ACCOUNT_AUTH_COPY.resetInvalid);
    setSaving(true);
    setError(null);
    try {
      await confirmPasswordReset(token.trim(), password);
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ACCOUNT_AUTH_COPY.resetInvalid);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title="Reset password" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {done ? (
          <>
            <Text style={styles.body}>{ACCOUNT_AUTH_COPY.resetDone}</Text>
            <PrimaryButton label="Sign in" onPress={() => router.replace("/sign-up")} />
          </>
        ) : (
          <>
            <TextInput
              accessibilityLabel="Reset code"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setToken}
              placeholder="Reset code"
              placeholderTextColor={colors.muted}
              style={styles.input}
              textContentType="oneTimeCode"
              value={token}
            />
            <TextInput
              accessibilityLabel="New password"
              autoCapitalize="none"
              autoComplete="new-password"
              onChangeText={setPassword}
              placeholder={`New password (at least ${PASSWORD_MIN_LENGTH} characters)`}
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
              textContentType="newPassword"
              value={password}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton disabled={saving} label="Set new password" onPress={() => void submit()} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
