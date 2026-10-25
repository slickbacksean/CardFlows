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
  TERMS_REQUIRED_CODE,
} from "@cardflow/shared";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState, useEffect } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Linking from "expo-linking";
import { authStyles } from "@/components/ui/auth-styles";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { InlineError } from "@/components/ui/screen-state";
import { SocialSignInButtons, type SocialToken } from "@/components/ui/social-sign-in";
import { peekActiveUserId, signInWithSocial, signUpWithEmail } from "@/lib/identity";
import { flushScanQueue } from "@/lib/scan-queue";
import { colors } from "@/lib/theme";
import { checkAndPromptUsername } from "@/lib/username-check";

/** Open sign-up / sign-in. First screen when signed out (Sean, Oct 18). Email and password only. */
export default function SignUpScreen() {
  const router = useRouter();
  // UX review P1-4: "Sign in" from a session-ended error opens this screen in sign-in mode.
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<"sign_up" | "sign_in">(() => (params.mode === "sign_in" ? "sign_in" : "sign_up"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creatorCode, setCreatorCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Policy Reviewer (Oct 17): required, unchecked by default.
  const [over18, setOver18] = useState(false);
  // Sean (Oct 19): required "I agree to the Terms of Service and Privacy Policy", unchecked by default.
  const [agreed, setAgreed] = useState(false);
  // A first Apple/Google sign-in waits here until both boxes are checked (no account before that).
  const [pendingSocial, setPendingSocial] = useState<SocialToken | null>(null);
  // Accounts from before the Terms accept them on their next sign-in (server: terms_required).
  const [termsNeeded, setTermsNeeded] = useState(false);
  const signedIn = !!peekActiveUserId();

  const extractCreatorCode = useCallback((url: string): string | null => {
    try {
      // Match pokesniper.app/c/<code> or deep link format
      const match = url.match(/\/c\/([a-zA-Z0-9_-]+)/);
      return match?.[1] || null;
    } catch {
      return null;
    }
  }, []);

  // Handle deep-link attribution from pokesniper.app/c/<code>
  useEffect(() => {
    async function handleInitialUrl() {
      const url = await Linking.getInitialURL();
      if (url) {
        const code = extractCreatorCode(url);
        if (code) setCreatorCode(code);
      }
    }
    
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const code = extractCreatorCode(url);
      if (code) setCreatorCode(code);
    });

    void handleInitialUrl();

    return () => {
      subscription.remove();
    };
  }, [extractCreatorCode]);

  const submit = useCallback(async () => {
    if (!isValidEmail(email)) {
      setError(ACCOUNT_AUTH_COPY.badEmail);
      return;
    }
    if (mode === "sign_up") {
      const problem = passwordProblem(password);
      if (problem) {
        setError(problem);
        return;
      }
      if (!over18) {
        setError(AGE_GATE_COPY.required);
        return;
      }
      if (!agreed) {
        setError(TERMS_COPY.required);
        return;
      }
    } else if (termsNeeded && !agreed) {
      setError(TERMS_COPY.required);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const session = await signUpWithEmail(email.trim(), password, mode, mode === "sign_up" && over18, (mode === "sign_up" || termsNeeded) && agreed, mode === "sign_up" && creatorCode ? creatorCode.trim() : undefined);
      void flushScanQueue();
      // Sean: new accounts confirm their email (6-digit code) before pre-grade estimates.
      if (session.emailVerified === false) {
        router.replace({ pathname: "/verify-email", params: { email: email.trim() } });
      } else {
        // Check for username after successful auth
        const hasUsername = await checkAndPromptUsername();
        if (hasUsername) {
          router.replace("/(tabs)/collection");
        }
      }
    } catch (caught) {
      if ((caught as { code?: string }).code === TERMS_REQUIRED_CODE) {
        setTermsNeeded(true);
        setError(TERMS_COPY.required);
        return;
      }
      setError(actionErrorMessage(caught, mode === "sign_up" ? ACCOUNT_AUTH_COPY.signUpFailed : ACCOUNT_AUTH_COPY.signInFailed));
    } finally {
      setSaving(false);
    }
  }, [email, password, mode, over18, agreed, creatorCode, termsNeeded, router]);

  const social = useCallback(async (token: SocialToken) => {
    setSaving(true);
    setError(null);
    try {
      await signInWithSocial({ ...token, ageConfirmed18Plus: over18, termsAccepted: agreed, creatorCode: creatorCode ? creatorCode.trim() : undefined });
      setPendingSocial(null);
      void flushScanQueue();
      
      // Check for username after successful social auth
      const hasUsername = await checkAndPromptUsername();
      if (hasUsername) {
        router.replace("/(tabs)/collection");
      }
    } catch (caught) {
      if ((caught as { code?: string }).code === TERMS_REQUIRED_CODE) {
        // Existing account from before the Terms: accept them, then Continue.
        setPendingSocial(token);
        setTermsNeeded(true);
        setError(TERMS_COPY.required);
      } else if ((caught as { code?: string }).code === "signup_details_required") {
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
  }, [over18, agreed, creatorCode, router]);

  // The 18+ box is for new accounts; the Terms box also shows when an existing account needs it.
  const showAge = mode === "sign_up" || (pendingSocial !== null && !termsNeeded);
  const showChecks = showAge || termsNeeded;
  const checksOk = agreed && (!showAge || over18);
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
        {mode === "sign_up" ? (
          <TextInput
            accessibilityLabel="Creator Code"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setCreatorCode}
            placeholder="Creator Code (optional)"
            placeholderTextColor={colors.muted}
            style={authStyles.input}
            value={creatorCode}
          />
        ) : null}
        {showAge ? (
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
        <Pressable accessibilityRole="button" onPress={() => { setMode(mode === "sign_up" ? "sign_in" : "sign_up"); setError(null); setPendingSocial(null); setTermsNeeded(false); }}>
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
