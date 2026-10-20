import {
  ACCOUNT_AUTH_COPY,
  AGE_GATE_COPY,
  PASSWORD_MIN_LENGTH,
  SIGNUP_ALLOWANCE_NOTE,
  isValidEmail,
  passwordProblem,
  actionErrorMessage,
  PRIVACY_URL,
  TERMS_COPY,
} from "@cardflow/shared";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { authStyles } from "@/components/ui/auth-styles";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { InlineError } from "@/components/ui/screen-state";
import { SocialSignInButtons, type SocialToken } from "@/components/ui/social-sign-in";
import { peekActiveUserId, signInWithSocial, signUpWithEmail } from "@/lib/identity";
import { flushScanQueue } from "@/lib/scan-queue";
import { colors } from "@/lib/theme";

/** Open sign-up / sign-in. First screen when signed out (Sean, Oct 18). Email and password only. */
export default function SignUpScreen() {
  const router = useRouter();
  // UX review P1-4: "Sign in" from a session-ended error opens this screen in sign-in mode.
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<"sign_up" | "sign_in">(() => (params.mode === "sign_in" ? "sign_in" : "sign_up"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Policy Reviewer (Oct 17): required, unchecked by default.
  const [over18, setOver18] = useState(false);
  // Sean (Oct 19): required "I agree to the Terms of Service and Privacy Policy", unchecked by default.
  const [agreed, setAgreed] = useState(false);
  // A first Apple/Google sign-in waits here until both boxes are checked (no account before that).
  const [pendingSocial, setPendingSocial] = useState<SocialToken | null>(null);
  const signedIn = !!peekActiveUserId();

  async function submit() {
    if (!isValidEmail(email)) return setError(ACCOUNT_AUTH_COPY.badEmail);
    if (mode === "sign_up") {
      const problem = passwordProblem(password);
      if (problem) return setError(problem);
      if (!over18) return setError(AGE_GATE_COPY.required);
      if (!agreed) return setError(TERMS_COPY.required);
    }
    setSaving(true);
    setError(null);
    try {
      const session = await signUpWithEmail(email.trim(), password, mode, mode === "sign_up" && over18, mode === "sign_up" && agreed);
      void flushScanQueue();
      // Sean: new accounts confirm their email (6-digit code) before pre-grade estimates.
      if (session.emailVerified === false) router.replace({ pathname: "/verify-email", params: { email: email.trim() } });
      else router.replace("/(tabs)/collection");
    } catch (caught) {
      setError(actionErrorMessage(caught, mode === "sign_up" ? ACCOUNT_AUTH_COPY.signUpFailed : ACCOUNT_AUTH_COPY.signInFailed));
    } finally {
      setSaving(false);
    }
  }

  async function social(token: SocialToken) {
    setSaving(true);
    setError(null);
    try {
      await signInWithSocial({ ...token, ageConfirmed18Plus: over18, termsAccepted: agreed });
      setPendingSocial(null);
      void flushScanQueue();
      router.replace("/(tabs)/collection");
    } catch (caught) {
      if ((caught as { code?: string }).code === "signup_details_required") {
        // New account: show both required boxes, then Continue retries with the same token.
        setPendingSocial(token);
        setMode("sign_up");
        setError(!over18 ? AGE_GATE_COPY.required : TERMS_COPY.required);
      } else {
        setPendingSocial(null);
        setError(actionErrorMessage(caught, ACCOUNT_AUTH_COPY.signInFailed));
      }
    } finally {
      setSaving(false);
    }
  }

  const showChecks = mode === "sign_up" || pendingSocial !== null;
  const checksOk = over18 && agreed;
  const title = mode === "sign_up" ? "Create account" : "Sign in";
  return (
    <View style={authStyles.flex}>
      <PreferencesScreenHeader dismiss={signedIn ? "back" : null} title={title} />
      <ScrollView contentContainerStyle={authStyles.content} keyboardShouldPersistTaps="handled">
        <Text style={authStyles.body}>Create a free account to use PokeSniper. Sign in if you already have one.</Text>
        <SocialSignInButtons disabled={saving} onError={(e) => setError(actionErrorMessage(e, ACCOUNT_AUTH_COPY.signInFailed))} onToken={(t) => void social(t)} />
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
        {showChecks ? (
          <Pressable
            accessibilityLabel={AGE_GATE_COPY.checkbox}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: over18 }}
            onPress={() => setOver18(!over18)}
            style={styles.checkRow}
          >
            <View style={[styles.box, over18 ? styles.boxOn : null]}>{over18 ? <Text style={styles.tick}>✓</Text> : null}</View>
            <Text style={styles.checkLabel}>{AGE_GATE_COPY.checkbox}</Text>
          </Pressable>
        ) : null}
        {showChecks ? (
          <View style={styles.checkRow}>
            <Pressable
              accessibilityLabel={TERMS_COPY.checkbox}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              hitSlop={8}
              onPress={() => setAgreed(!agreed)}
            >
              <View style={[styles.box, agreed ? styles.boxOn : null]}>{agreed ? <Text style={styles.tick}>✓</Text> : null}</View>
            </Pressable>
            <Text style={styles.checkLabel}>
              I agree to the{" "}
              <Text accessibilityRole="link" onPress={() => router.push("/terms")} style={styles.inlineLink}>
                {TERMS_COPY.termsLink}
              </Text>{" "}
              and{" "}
              <Text accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} style={styles.inlineLink}>
                {TERMS_COPY.privacyLink}
              </Text>
            </Text>
          </View>
        ) : null}
        {mode === "sign_up" && !over18 ? <Text style={authStyles.body}>{AGE_GATE_COPY.disabledCaption}</Text> : null}
        {mode === "sign_up" ? <Text style={authStyles.body}>{AGE_GATE_COPY.signUpLine}</Text> : null}
        <InlineError message={error} />
        {pendingSocial ? (
          <PrimaryButton disabled={saving || !checksOk} label={saving ? "Creating account…" : `Continue with ${pendingSocial.provider === "apple" ? "Apple" : "Google"}`} onPress={() => void social(pendingSocial)} />
        ) : (
          <PrimaryButton accessibilityHint={mode === "sign_up" && !over18 ? AGE_GATE_COPY.disabledHint : undefined} disabled={saving || (mode === "sign_up" && !over18) || (mode === "sign_up" && !agreed)} label={saving ? (mode === "sign_up" ? "Creating account…" : "Signing in…") : title} onPress={() => void submit()} />
        )}
        <Pressable accessibilityRole="button" onPress={() => { setMode(mode === "sign_up" ? "sign_in" : "sign_up"); setError(null); setPendingSocial(null); }}>
          <Text style={authStyles.link}>{mode === "sign_up" ? "Already have an account? Sign in" : "New here? Create an account"}</Text>
        </Pressable>
        {mode === "sign_in" ? (
          <Pressable accessibilityRole="button" onPress={() => router.push("/forgot-password")}>
            <Text style={authStyles.link}>Forgot password?</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  checkRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: Platform.OS === "android" ? 48 : 44 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.muted, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.accentText, fontSize: 16, fontWeight: "700" },
  checkLabel: { color: colors.text, fontSize: 16, flexShrink: 1 },
  inlineLink: { color: colors.accent, textDecorationLine: "underline" },
});
