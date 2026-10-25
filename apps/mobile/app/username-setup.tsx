import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { PrimaryButton } from "@/components/ui/primary-button";
import { InlineError } from "@/components/ui/screen-state";
import { checkUsernameAvailability, setUsername as setUsernameApi } from "@/lib/api";
import { colors, radii, space } from "@/lib/theme";

interface UsernameSetupScreenProps {
  isNewUser?: boolean;
  canSkip?: boolean;
}

export default function UsernameSetupScreen() {
  const router = useRouter();
  const [username, setUsernameValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<{ available: boolean; reason?: string } | null>(null);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced availability check
  useEffect(() => {
    if (checkTimerRef.current) {
      clearTimeout(checkTimerRef.current);
    }

    const trimmed = username.trim();
    if (trimmed.length < 3) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAvailability(null);
      setChecking(false);
      return;
    }

    setChecking(true);
    checkTimerRef.current = setTimeout(() => {
      void checkUsernameAvailability(trimmed)
        .then((result) => {
          setAvailability(result);
          setChecking(false);
        })
        .catch(() => {
          setChecking(false);
        });
    }, 500);

    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
  }, [username]);

  const trimmed = username.trim();
  const isValid = trimmed.length >= 3 && trimmed.length <= 20 && /^[a-zA-Z0-9_]+$/.test(trimmed);
  const canSubmit = isValid && availability?.available && !saving;

  async function handleSubmit() {
    if (!canSubmit) return;

    setSaving(true);
    setError(null);

    try {
      const result = await setUsernameApi(trimmed);
      if ("error" in result) {
        setError(result.error);
      } else {
        // Success! Navigate to main app
        router.replace("/(tabs)/collection");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to set username");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <PreferencesScreenHeader dismiss={null} title="Choose Username" />

      <View style={styles.content}>
        <Text style={styles.title}>Pick your username</Text>
        <Text style={styles.body}>
          Your username is how you&apos;ll appear when you share purchases in the Community feed. You can
          keep it anonymous or show your username.
        </Text>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Username</Text>
          <View style={styles.inputWrapper}>
            <Text style={styles.inputPrefix}>@</Text>
            <TextInput
              accessibilityLabel="Username"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              autoFocus
              maxLength={20}
              onChangeText={setUsernameValue}
              onSubmitEditing={() => void handleSubmit()}
              placeholder="username"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              style={styles.input}
              value={username}
            />
            {checking ? (
              <ActivityIndicator color={colors.muted} size="small" />
            ) : availability !== null ? (
              <Text style={availability.available ? styles.available : styles.unavailable}>
                {availability.available ? "✓" : "✗"}
              </Text>
            ) : null}
          </View>
          <Text style={styles.inputHint}>3-20 characters: letters, numbers, and underscores</Text>
          {availability && !availability.available && availability.reason ? (
            <Text style={styles.inputError}>{availability.reason}</Text>
          ) : null}
        </View>

        <InlineError message={error} />

        <PrimaryButton
          disabled={!canSubmit}
          label={saving ? "Saving..." : "Continue"}
          onPress={() => void handleSubmit()}
        />

        <Text style={styles.note}>
          You can change your username once every 30 days in Settings. Your username is visible to
          others only when you choose to post publicly.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: space.lg,
    gap: space.md,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginTop: space.md,
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  inputContainer: {
    gap: space.xs,
  },
  inputLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.md,
    paddingHorizontal: space.sm,
  },
  inputPrefix: {
    color: colors.muted,
    fontSize: 17,
    fontWeight: "600",
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
  },
  available: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: "700",
  },
  unavailable: {
    color: colors.danger,
    fontSize: 20,
    fontWeight: "700",
  },
  inputHint: {
    color: colors.muted,
    fontSize: 13,
  },
  inputError: {
    color: colors.danger,
    fontSize: 13,
  },
  note: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: space.md,
  },
});
