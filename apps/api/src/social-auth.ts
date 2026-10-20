/**
 * Sean (Oct 19): Sign in with Apple and Google. The app sends the provider's ID token; the API
 * verifies it against the provider's JWKS (issuer, audience, expiry, and the Apple nonce) and
 * returns the verified subject + email. Each provider is off until its env flag / client IDs are set:
 *   CARD_FLOW_APPLE_SIGNIN=true          (audience CARD_FLOW_APPLE_AUDIENCES, default app.pokesniper.mobile)
 *   CARD_FLOW_GOOGLE_CLIENT_IDS=a,b,c    (iOS, Android and web OAuth client IDs)
 */
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { SocialProvider } from "./account-store";

export const APPLE_BUNDLE_ID = "app.pokesniper.mobile";
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS = "https://appleid.apple.com/auth/keys";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";

export interface VerifiedSocialIdentity {
  provider: SocialProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

export interface SocialAuthConfig {
  appleAudiences: string[];
  googleClientIds: string[];
}

/** Throws on any invalid token. `nonce` is the raw nonce the app generated (Apple hashes it). */
export type SocialTokenVerifier = (input: { provider: SocialProvider; idToken: string; nonce?: string | null }) => Promise<VerifiedSocialIdentity>;

const list = (raw: string | undefined) => (raw ?? "").split(",").map((v) => v.trim()).filter(Boolean);

export function socialAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SocialAuthConfig {
  const appleOn = env.CARD_FLOW_APPLE_SIGNIN?.trim().toLowerCase() === "true";
  const appleAudiences = list(env.CARD_FLOW_APPLE_AUDIENCES);
  return {
    appleAudiences: appleOn ? (appleAudiences.length ? appleAudiences : [APPLE_BUNDLE_ID]) : [],
    googleClientIds: list(env.CARD_FLOW_GOOGLE_CLIENT_IDS),
  };
}

export function socialProviderEnabled(config: SocialAuthConfig, provider: SocialProvider): boolean {
  return provider === "apple" ? config.appleAudiences.length > 0 : config.googleClientIds.length > 0;
}

const truthy = (v: unknown) => v === true || v === "true";
const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/** Checks claims already signature-verified by jose (exported for tests). */
export function socialIdentityFromClaims(
  provider: SocialProvider,
  payload: JWTPayload & Record<string, unknown>,
  nonce?: string | null,
): VerifiedSocialIdentity {
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("token has no subject");
  if (provider === "apple" && nonce != null) {
    // expo-apple-authentication sends SHA-256(raw nonce); Apple puts that hash in the token.
    if (payload.nonce !== sha256Hex(nonce) && payload.nonce !== nonce) throw new Error("nonce mismatch");
  }
  if (provider === "google" && nonce != null && payload.nonce != null && payload.nonce !== nonce) {
    throw new Error("nonce mismatch");
  }
  const email = typeof payload.email === "string" ? payload.email : null;
  return { provider, subject: payload.sub, email, emailVerified: Boolean(email) && truthy(payload.email_verified) };
}

export function createJwksSocialVerifier(config: SocialAuthConfig): SocialTokenVerifier {
  const appleKeys = createRemoteJWKSet(new URL(APPLE_JWKS));
  const googleKeys = createRemoteJWKSet(new URL(GOOGLE_JWKS));
  return async ({ provider, idToken, nonce }) => {
    if (!socialProviderEnabled(config, provider)) throw new Error(`${provider} sign-in is off`);
    const { payload } =
      provider === "apple"
        ? await jwtVerify(idToken, appleKeys, { issuer: APPLE_ISSUER, audience: config.appleAudiences })
        : await jwtVerify(idToken, googleKeys, { issuer: GOOGLE_ISSUERS, audience: config.googleClientIds });
    return socialIdentityFromClaims(provider, payload as JWTPayload & Record<string, unknown>, nonce);
  };
}
