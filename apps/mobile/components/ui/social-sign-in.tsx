/* eslint-disable @typescript-eslint/no-require-imports -- optional native modules load lazily (PR 113 review) */
/**
 * Sean (Oct 19): Sign in with Apple (iOS) and Google, next to email/password. Expo Go compatible:
 * expo-apple-authentication ships in Expo Go on iOS; Google uses expo-auth-session (PKCE) in the
 * system browser. Each button shows only when the server has the provider on (GET /v1/auth/providers)
 * and, for Google, when this build has a client ID for the platform:
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
 * The server verifies the ID token (signature, issuer, audience, nonce) before any session.
 */
import { requireOptionalNativeModule } from "expo";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { getAuthProviders } from "@/lib/api";
import { colors } from "@/lib/theme";

/*
 * Mobile Tech Lead (PR 113): no forced rebuild. Like device-level.ts / live-video-native.ts, each
 * native-backed module is loaded only when its native module is in this binary; otherwise the
 * button is hidden (current dev client, Expo Go without it).
 */
type AppleModule = typeof import("expo-apple-authentication");
type CryptoModule = typeof import("expo-crypto");
type GoogleModule = typeof import("expo-auth-session/providers/google");

function loadOptional<T>(nativeName: string, load: () => T): T | null {
  try {
    return requireOptionalNativeModule(nativeName) ? load() : null;
  } catch {
    return null;
  }
}

const APPLE_BUILD_FLAG = process.env.EXPO_PUBLIC_APPLE_SIGNIN_ENABLED?.trim() === "1";
const Crypto = loadOptional<CryptoModule>("ExpoCrypto", () => require("expo-crypto"));
const AppleAuthentication =
  Platform.OS === "ios" && APPLE_BUILD_FLAG && Crypto
    ? loadOptional<AppleModule>("ExpoAppleAuthentication", () => require("expo-apple-authentication"))
    : null;
const Google = Crypto
  ? loadOptional<GoogleModule>("ExpoWebBrowser", () => {
      const browser = require("expo-web-browser") as typeof import("expo-web-browser");
      browser.maybeCompleteAuthSession();
      return require("expo-auth-session/providers/google");
    })
  : null;

export interface SocialToken {
  provider: "apple" | "google";
  idToken: string;
  nonce?: string;
  /** Apple only: one-time code the API exchanges so account deletion can revoke the token. */
  authorizationCode?: string;
}

const GOOGLE_IDS = {
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || undefined,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim() || undefined,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || undefined,
};

function googleConfiguredForPlatform(): boolean {
  if (Platform.OS === "ios") return Boolean(GOOGLE_IDS.iosClientId);
  if (Platform.OS === "android") return Boolean(GOOGLE_IDS.androidClientId);
  return Boolean(GOOGLE_IDS.webClientId);
}

async function appleToken(): Promise<SocialToken | null> {
  if (!AppleAuthentication || !Crypto) return null;
  const rawNonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    return credential.identityToken
      ? { provider: "apple", idToken: credential.identityToken, nonce: rawNonce, authorizationCode: credential.authorizationCode ?? undefined }
      : null;
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_REQUEST_CANCELED") return null;
    throw error;
  }
}

function GoogleButton({ google, disabled, onToken, onError }: { google: GoogleModule; disabled: boolean; onToken: (t: SocialToken) => void; onError: (e: unknown) => void }) {
  const [request, response, promptAsync] = google.useIdTokenAuthRequest(GOOGLE_IDS);
  useEffect(() => {
    if (response?.type !== "success") return;
    const idToken = response.params.id_token ?? response.authentication?.idToken;
    if (idToken) onToken({ provider: "google", idToken });
    else onError(new Error("Google didn't return a sign-in token."));
  }, [response, onToken, onError]);
  return (
    <Pressable
      accessibilityLabel="Sign in with Google"
      accessibilityRole="button"
      disabled={disabled || !request}
      onPress={() => void promptAsync().catch(onError)}
      style={[styles.google, disabled || !request ? styles.dim : null]}
    >
      <Text style={styles.googleText}>Sign in with Google</Text>
    </Pressable>
  );
}

export function SocialSignInButtons({ disabled, onToken, onError }: { disabled: boolean; onToken: (t: SocialToken) => void; onError: (e: unknown) => void }) {
  const [server, setServer] = useState<{ apple: boolean; google: boolean }>({ apple: false, google: false });
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    void getAuthProviders()
      .then((p) => setServer({ apple: p.apple, google: p.google }))
      .catch(() => undefined);
    if (AppleAuthentication) void AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => undefined);
  }, []);
  const showApple = AppleAuthentication !== null && appleAvailable && server.apple;
  const showGoogle = Google !== null && server.google && googleConfiguredForPlatform();
  if (!showApple && !showGoogle) return null;
  return (
    <View style={styles.stack}>
      {showApple && AppleAuthentication ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          cornerRadius={12}
          onPress={() => {
            if (disabled) return;
            void appleToken().then((t) => t && onToken(t)).catch(onError);
          }}
          style={styles.apple}
        />
      ) : null}
      {showGoogle && Google ? <GoogleButton google={Google} disabled={disabled} onError={onError} onToken={onToken} /> : null}
      <Text style={styles.or}>or use email</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  apple: { height: 48, width: "100%" },
  google: { height: 48, borderRadius: 12, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
  googleText: { color: "#1f1f1f", fontSize: 16, fontWeight: "600" },
  dim: { opacity: 0.5 },
  or: { color: colors.muted, textAlign: "center", fontSize: 14 },
});
