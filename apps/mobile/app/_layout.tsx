import { QueryClientProvider } from "@tanstack/react-query";
import { type ErrorBoundaryProps, Link, Redirect, Stack, router, useSegments } from "expo-router";
import { EMAIL_VERIFICATION_COPY, RELEASE_API_URL_ERROR_COPY, isGuestUserId, releaseApiUrlProblem } from "@cardflow/shared";
import { onEmailUnverified, onSignupRequired } from "@/lib/api";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { startWriteQueue } from "@/lib/write-queue";
import { startScanQueue } from "@/lib/scan-queue";
import { flushProductEvents, loadAnalyticsPreference } from "@/lib/product-events";
import { Alert, AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/ui/primary-button";
import { ensureIdentitySession, subscribeAuth } from "@/lib/identity";
import { showSignupPrompt } from "@/lib/signup-prompt";
import { cardFlowQueryClient } from "@/lib/query-client";
import { captureMobileException, initMobileSentry, loadCrashReportsPreference } from "@/lib/sentry";
import { colors, space } from "@/lib/theme";

// Policy Reviewer (P4): Settings > Send crash reports (off by default, opt-in) gates Sentry.
void loadCrashReportsPreference().then(() => initMobileSentry());

/** Routes reachable while signed out (auth stack only). */
const AUTH_SEGMENTS = new Set([
  "sign-up",
  "forgot-password",
  "reset-password",
  "verify-email",
]);

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

/**
 * Dev Ops review (P4, blocking): a release build (!__DEV__) without a usable EXPO_PUBLIC_API_URL
 * shows this screen instead of the app, and never falls back to 127.0.0.1 / 10.0.2.2.
 * app.config.ts already refuses to build preview/production without one; this is the backstop.
 */
const RELEASE_API_URL_PROBLEM = releaseApiUrlProblem({ configured: process.env.EXPO_PUBLIC_API_URL, isDev: __DEV__ });

function ReleaseConfigErrorScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View accessibilityRole="alert" style={styles.stack}>
        <Text style={styles.title}>{RELEASE_API_URL_ERROR_COPY.title}</Text>
        <Text style={styles.body}>{RELEASE_API_URL_ERROR_COPY.body}</Text>
      </View>
    </SafeAreaView>
  );
}

export default function RootLayout() {
  if (RELEASE_API_URL_PROBLEM) return <ReleaseConfigErrorScreen />;
  return <AppRoot />;
}

function AppRoot() {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const segments = useSegments();
  const signedIn = !!userId && !isGuestUserId(userId);
  const inAuthRoute = AUTH_SEGMENTS.has(segments[0] ?? "");

  useEffect(() => {
    // D7: send queued opt-in events when the app goes to the background.
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") void flushProductEvents();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    void loadAnalyticsPreference();
    const unsub = subscribeAuth(setUserId);
    void ensureIdentitySession()
      .catch(() => undefined)
      .finally(() => setReady(true));
    return unsub;
  }, []);

  // Safety net: leftover guest tokens or mid-flow 403 signup_required → sign-up screen.
  useEffect(() => onSignupRequired(() => showSignupPrompt()), []);
  // Sean: pre-grade estimates need a verified email. One prompt, then the code screen.
  useEffect(() => {
    let showing = false;
    return onEmailUnverified(() => {
      if (showing) return;
      showing = true;
      // UX review P1-8 / Community review 2: plain copy, a Verify email button, and the
      // code screen knows a pre-grade estimate is waiting.
      Alert.alert(EMAIL_VERIFICATION_COPY.promptTitle, EMAIL_VERIFICATION_COPY.promptBody, [
        { text: "Not now", style: "cancel", onPress: () => { showing = false; } },
        { text: "Verify email", onPress: () => { showing = false; router.push({ pathname: "/verify-email", params: { from: "pregrade" } }); } },
      ], { cancelable: true, onDismiss: () => { showing = false; } });
    });
  }, []);
  useEffect(() => (ready && signedIn ? startWriteQueue() : undefined), [ready, signedIn]);
  useEffect(() => (ready && signedIn ? startScanQueue() : undefined), [ready, signedIn]);

  if (!ready) return null;

  // Sean (Oct 18): free account required. Signed-out users only see the auth stack.
  if (!signedIn && !inAuthRoute) {
    return <Redirect href="/sign-up" />;
  }

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
        <Stack.Screen name="scan-summary/[scanId]" options={{ headerShown: false }} />
        <Stack.Screen name="decide/[cardflowCardId]" options={{ headerShown: false }} />
        <Stack.Screen name="draft/[draftId]" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="sign-up" options={{ headerShown: false }} />
        <Stack.Screen name="about" options={{ headerShown: false }} />
        <Stack.Screen name="analytics" options={{ headerShown: false }} />
        <Stack.Screen name="practice" options={{ headerShown: false }} />
        <Stack.Screen name="max-buy-rules" options={{ headerShown: false }} />
        <Stack.Screen name="watch" options={{ headerShown: false }} />
        <Stack.Screen name="verify-email" options={{ headerShown: false }} />
        <Stack.Screen name="delete-account" options={{ headerShown: false }} />
        <Stack.Screen name="crash-reports" options={{ headerShown: false }} />
        <Stack.Screen name="card-recognition" options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
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
