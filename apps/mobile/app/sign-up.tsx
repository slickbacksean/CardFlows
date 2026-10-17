import {
  ACCOUNT_AUTH_COPY,
  GUEST_RETENTION_NOTE,
  PASSWORD_MIN_LENGTH,
  SIGNUP_FREE_PLAN_NOTE,
  isValidEmail,
  passwordProblem,
} from "@cardflow/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { isGuestSession, signUpWithEmail } from "@/lib/identity";
import { flushScanQueue } from "@/lib/scan-queue";
import { colors, space } from "@/lib/theme";

/** Open sign-up (email + password). Testers can still use an invite code. */
export default function SignUpScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign_up" | "sign_in">("sign_up");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const guest = isGuestSession();

  async function submit() {
    if (!isValidEmail(email)) return setError(ACCOUNT_AUTH_COPY.badEmail);
    if (mode === "sign_up") {
      const problem = passwordProblem(password);
      if (problem) return setError(problem);
    }
    setSaving(true);
    setError(null);
    try {
      await signUpWithEmail(email.trim(), password, mode);
      void flushScanQueue();
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ACCOUNT_AUTH_COPY.signInFailed);
    } finally {
      setSaving(false);
    }
  }

  const title = mode === "sign_up" ? "Create account" : "Sign in";
  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title={title} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {guest ? <Text style={styles.body}>Your guest scans move to your account. {GUEST_RETENTION_NOTE}</Text> : null}
        {mode === "sign_up" ? <Text style={styles.body}>{SIGNUP_FREE_PLAN_NOTE}</Text> : null}
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
        <TextInput
          accessibilityLabel="Password"
          autoCapitalize="none"
          autoComplete={mode === "sign_up" ? "new-password" : "current-password"}
          onChangeText={setPassword}
          placeholder={mode === "sign_up" ? `Password (at least ${PASSWORD_MIN_LENGTH} characters)` : "Password"}
          placeholderTextColor={colors.muted}
          secureTextEntry
          style={styles.input}
          textContentType={mode === "sign_up" ? "newPassword" : "password"}
          value={password}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton disabled={saving} label={title} onPress={() => void submit()} />
        <Pressable accessibilityRole="button" onPress={() => { setMode(mode === "sign_up" ? "sign_in" : "sign_up"); setError(null); }}>
          <Text style={styles.link}>{mode === "sign_up" ? "Already have an account? Sign in" : "New here? Create an account"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push("/switch-tester")}>
          <Text style={styles.link}>Have a tester invite code?</Text>
        </Pressable>
      </ScrollView>
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
  link: { color: colors.accent, fontSize: 15, fontWeight: "600" },
});
