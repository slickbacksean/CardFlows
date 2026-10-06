import { type ErrorBoundaryProps, Link, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/ui/primary-button";
import { ensureIdentitySession } from "@/lib/identity";
import { colors, space } from "@/lib/theme";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
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

  useEffect(() => {
    void ensureIdentitySession()
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <>
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
        <Stack.Screen name="about" options={{ headerShown: false }} />
        <Stack.Screen name="max-buy-rules" options={{ headerShown: false }} />
        <Stack.Screen name="watch" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="light" />
    </>
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
