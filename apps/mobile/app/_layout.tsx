import { QueryClientProvider } from "@tanstack/react-query";
import { type ErrorBoundaryProps, Link, Stack, router } from "expo-router";
import { EMAIL_VERIFICATION_COPY, GUEST_RETENTION_NOTE, GUEST_SCAN_WALL_NOTE, GUEST_SIGNUP_COPY, signupMessage } from "@cardflow/shared";
import { onAgeConfirmationRequired, onEmailUnverified, onSignupRequired } from "@/lib/api";
import { loadAgeLockout, needsAgeGate, onAgeLockout, registerAgeGateOpener } from "@/lib/age-gate";
import { AgeLockout } from "@/components/ui/age-lockout";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { startWriteQueue } from "@/lib/write-queue";
import { startScanQueue } from "@/lib/scan-queue";
import { flushProductEvents, loadAnalyticsPreference } from "@/lib/product-events";
import { Alert, AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/ui/primary-button";
import { ensureIdentitySession, isGuestSession, peekActiveUserId } from "@/lib/identity";
import { cardFlowQueryClient } from "@/lib/query-client";
import { captureMobileException, initMobileSentry } from "@/lib/sentry";
import { colors, space } from "@/lib/theme";

initMobileSentry();

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  captureMobileException(error);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.stack}>
        <Text style={styles.title}>Something went wrong.</Text>
        <Text style={styles.body}>CardFlow hit an unexpected error.</Text>
        {__DEV__ ? <Text style={styles.detail}>{error.message}</Text> : null}
        <PrimaryButton label="Try again" onPress={retry} />
        <Link href="/(tabs)/collection" style={styles.link}>
          Collection
        </Link>
      </View>
    </SafeAreaView>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [lockedOut, setLockedOut] = useState(false);

  useEffect(() => {
    // D7: send queued opt-in events when the app goes to the background.
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") void flushProductEvents();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Sean: 18+ only. A phone locked out by the age gate loads nothing and sends nothing.
    void loadAgeLockout().then((locked) => {
      if (locked) {
        setLockedOut(true);
        return;
      }
      void loadAnalyticsPreference();
      void ensureIdentitySession()
        .catch(() => undefined)
        .finally(() => setReady(true));
    });
    return onAgeLockout(() => setLockedOut(true));
  }, []);

  // Age gate: before the first upload (then the CardSight prompt), when the API refuses an
  // upload without it, and at launch for signed-in testers and accounts that haven't answered.
  useEffect(() => {
    if (!ready) return;
    let open = false;
    const show = () => {
      if (open) return;
      open = true;
      router.push("/age-gate");
      setTimeout(() => { open = false; }, 1000);
    };
    const offOpener = registerAgeGateOpener(show);
    const offRequired = onAgeConfirmationRequired(show);
    const userKey = peekActiveUserId();
    if (userKey && !isGuestSession()) {
      void needsAgeGate(userKey).then((needed) => {
        if (needed) show();
      });
    }
    return () => {
      offOpener();
      offRequired();
    };
  }, [ready]);

  // D9: one sign-up prompt when the API says a guest has to sign up.
  useEffect(() => {
    let showing = false;
    return onSignupRequired((reason) => {
      if (showing) return;
      showing = true;
      const message = `${signupMessage(reason)}\n\n${reason === "scan_limit" ? GUEST_SCAN_WALL_NOTE : GUEST_RETENTION_NOTE}`;
      Alert.alert(GUEST_SIGNUP_COPY.title, message, [
        { text: GUEST_SIGNUP_COPY.dismiss, style: "cancel", onPress: () => { showing = false; } },
        { text: GUEST_SIGNUP_COPY.action, onPress: () => { showing = false; router.push("/sign-up"); } },
      ], { cancelable: true, onDismiss: () => { showing = false; } });
    });
  }, []);
  // Sean: pre-grade estimates need a verified email. One prompt, then the code screen.
  useEffect(() => {
    let showing = false;
    return onEmailUnverified(() => {
      if (showing) return;
      showing = true;
      Alert.alert("Verify your email", EMAIL_VERIFICATION_COPY.required, [
        { text: "Not now", style: "cancel", onPress: () => { showing = false; } },
        { text: "Enter code", onPress: () => { showing = false; router.push("/verify-email"); } },
      ], { cancelable: true, onDismiss: () => { showing = false; } });
    });
  }, []);
  useEffect(() => (ready ? startWriteQueue() : undefined), [ready]);
  useEffect(() => (ready ? startScanQueue() : undefined), [ready]);

  if (lockedOut) return <AgeLockout />;
  if (!ready) return null;

  return (
    <QueryClientProvider client={cardFlowQueryClient}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "700" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" options={{ headerShown: false }} />
        <Stack.Screen
          name="capture"
          options={{ headerShown: false, animation: "fade", gestureEnabled: true }}
        />
        <Stack.Screen name="scan/[scanId]" options={{ headerShown: false }} />
        <Stack.Screen name="decide/[cardflowCardId]" options={{ headerShown: false }} />
        <Stack.Screen name="draft/[draftId]" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="switch-tester" options={{ headerShown: false }} />
        <Stack.Screen name="sign-up" options={{ headerShown: false }} />
        <Stack.Screen name="about" options={{ headerShown: false }} />
        <Stack.Screen name="analytics" options={{ headerShown: false }} />
        <Stack.Screen name="practice" options={{ headerShown: false }} />
        <Stack.Screen name="max-buy-rules" options={{ headerShown: false }} />
        <Stack.Screen name="watch" options={{ headerShown: false }} />
        <Stack.Screen name="verify-email" options={{ headerShown: false }} />
        <Stack.Screen name="card-recognition" options={{ headerShown: false }} />
        <Stack.Screen name="age-gate" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack>
      <StatusBar style="light" />
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    padding: space.lg,
  },
  stack: { gap: space.md },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 16, lineHeight: 22 },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  link: { color: colors.cta, fontSize: 16, fontWeight: "700" },
});
