import { EMAIL_CODE_LENGTH, EMAIL_RESEND_COOLDOWN_MS, EMAIL_VERIFICATION_COPY, isEmailCode } from "@cardflow/shared";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { authStyles as styles } from "@/components/ui/auth-styles";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { confirmEmailVerification, requestEmailVerification } from "@/lib/api";
import { colors } from "@/lib/theme";

/** Sean: confirm the emailed 6-digit code before pre-grade estimates. Resend once a minute. */
export default function VerifyEmailScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>(EMAIL_VERIFICATION_COPY.sent);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState(false);
  // Sign-up just sent a code, so the resend button starts on its cooldown.
  const [resendAt, setResendAt] = useState(() => Date.now() + EMAIL_RESEND_COOLDOWN_MS);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const waitSeconds = Math.max(0, Math.ceil((resendAt - clock) / 1000));

  async function submit() {
    if (!isEmailCode(code)) return setError(EMAIL_VERIFICATION_COPY.invalid);
    setSaving(true);
    setError(null);
    try {
      await confirmEmailVerification(code.trim());
      setVerified(true);
      setNotice(EMAIL_VERIFICATION_COPY.verified);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : EMAIL_VERIFICATION_COPY.invalid);
    } finally {
      setSaving(false);
    }
  }

  async function resend() {
    setError(null);
    setResendAt(Date.now() + EMAIL_RESEND_COOLDOWN_MS);
    try {
      const res = await requestEmailVerification();
      if (res.emailVerified) {
        setVerified(true);
        setNotice(EMAIL_VERIFICATION_COPY.verified);
      } else {
        setNotice(EMAIL_VERIFICATION_COPY.sent);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : EMAIL_VERIFICATION_COPY.tooSoon);
    }
  }

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title="Verify email" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.body}>{notice}</Text>
        {verified ? (
          <PrimaryButton label="Done" onPress={() => router.back()} />
        ) : (
          <>
            <TextInput
              accessibilityLabel="Verification code"
              autoComplete="one-time-code"
              inputMode="numeric"
              keyboardType="number-pad"
              maxLength={EMAIL_CODE_LENGTH}
              onChangeText={(value) => setCode(value.replace(/\D/g, ""))}
              placeholder={`${EMAIL_CODE_LENGTH}-digit code`}
              placeholderTextColor={colors.muted}
              style={styles.input}
              textContentType="oneTimeCode"
              value={code}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton disabled={saving || code.length !== EMAIL_CODE_LENGTH} label="Verify email" onPress={() => void submit()} />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: waitSeconds > 0 }}
              disabled={waitSeconds > 0}
              onPress={() => void resend()}
            >
              <Text style={[styles.link, waitSeconds > 0 ? { color: colors.muted } : null]}>
                {waitSeconds > 0 ? `Resend code in ${waitSeconds}s` : "Resend code"}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}
