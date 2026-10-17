import {
  ACCOUNT_AUTH_COPY,
  AGE_GATE_COPY,
  GUEST_RETENTION_NOTE,
  PASSWORD_MIN_LENGTH,
  SIGNUP_ALLOWANCE_NOTE,
  isValidEmail,
  passwordProblem,
} from "@cardflow/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { authStyles } from "@/components/ui/auth-styles";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { ensureAgeConfirmed } from "@/lib/age-gate";
import { isGuestSession, peekActiveUserId, signUpWithEmail } from "@/lib/identity";
import { flushScanQueue } from "@/lib/scan-queue";
import { colors } from "@/lib/theme";

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
      // Sean: 18+ only. The age gate comes first (the server refuses sign-up without it).
      if (!(await ensureAgeConfirmed(peekActiveUserId()))) return;
    }
    setSaving(true);
    setError(null);
    try {
      const session = await signUpWithEmail(email.trim(), password, mode);
      void flushScanQueue();
      // Sean: new accounts confirm their email (6-digit code) before pre-grade estimates.
      if (session.emailVerified === false) router.replace("/verify-email");
      else router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ACCOUNT_AUTH_COPY.signInFailed);
    } finally {
      setSaving(false);
    }
  }

  const title = mode === "sign_up" ? "Create account" : "Sign in";
  return (
    <View style={authStyles.flex}>
      <PreferencesScreenHeader dismiss="back" title={title} />
      <ScrollView contentContainerStyle={authStyles.content} keyboardShouldPersistTaps="handled">
        {guest ? <Text style={authStyles.body}>Your guest scans move to your account. {GUEST_RETENTION_NOTE}</Text> : null}
        {mode === "sign_up" ? <Text style={authStyles.body}>{SIGNUP_ALLOWANCE_NOTE}</Text> : null}
        <TextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          inputMode="email"
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={colors.muted}
          style={authStyles.input}
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
          style={authStyles.input}
          textContentType={mode === "sign_up" ? "newPassword" : "password"}
          value={password}
        />
        {error ? <Text style={authStyles.error}>{error}</Text> : null}
        {mode === "sign_up" ? <Text style={authStyles.body}>{AGE_GATE_COPY.signUpLine}</Text> : null}
        <PrimaryButton disabled={saving} label={title} onPress={() => void submit()} />
        <Pressable accessibilityRole="button" onPress={() => { setMode(mode === "sign_up" ? "sign_in" : "sign_up"); setError(null); }}>
          <Text style={authStyles.link}>{mode === "sign_up" ? "Already have an account? Sign in" : "New here? Create an account"}</Text>
        </Pressable>
        {mode === "sign_in" ? (
          <Pressable accessibilityRole="button" onPress={() => router.push("/forgot-password")}>
            <Text style={authStyles.link}>Forgot password?</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => router.push("/switch-tester")}>
          <Text style={authStyles.link}>Have a tester invite code?</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
