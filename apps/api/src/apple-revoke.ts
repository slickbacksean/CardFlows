/**
 * App Review 5.1.1(v): deleting an account that used Sign in with Apple must revoke the user's
 * Apple token. At sign-in the app sends Apple's one-time authorization code; the API exchanges it
 * for a refresh token (stored encrypted) and revokes it when the account is deleted.
 * Needs CARD_FLOW_APPLE_TEAM_ID, CARD_FLOW_APPLE_KEY_ID, CARD_FLOW_APPLE_PRIVATE_KEY (.p8 PEM)
 * and optionally CARD_FLOW_APPLE_CLIENT_ID (default app.pokesniper.mobile).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { serverPepper } from "./server-pepper";

const APPLE = "https://appleid.apple.com";

export interface AppleTokenClient {
  /** Authorization code → refresh token (null when Apple refuses). */
  exchangeCode(code: string): Promise<string | null>;
  revoke(refreshToken: string): Promise<boolean>;
}

export interface AppleKeyConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  clientId: string;
}

export function appleKeyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppleKeyConfig | null {
  const teamId = env.CARD_FLOW_APPLE_TEAM_ID?.trim();
  const keyId = env.CARD_FLOW_APPLE_KEY_ID?.trim();
  const privateKey = env.CARD_FLOW_APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!teamId || !keyId || !privateKey) return null;
  return { teamId, keyId, privateKey, clientId: env.CARD_FLOW_APPLE_CLIENT_ID?.trim() || "app.pokesniper.mobile" };
}

export function createAppleTokenClient(config: AppleKeyConfig, fetchImpl: typeof fetch = fetch): AppleTokenClient {
  const clientSecret = async () =>
    new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: config.keyId })
      .setIssuer(config.teamId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .setAudience(APPLE)
      .setSubject(config.clientId)
      .sign(await importPKCS8(config.privateKey, "ES256"));
  const post = async (path: string, form: Record<string, string>) =>
    fetchImpl(`${APPLE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: await clientSecret(), ...form }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  return {
    async exchangeCode(code) {
      const res = await post("/auth/token", { grant_type: "authorization_code", code });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => ({}))) as { refresh_token?: unknown };
      return typeof body.refresh_token === "string" ? body.refresh_token : null;
    },
    async revoke(refreshToken) {
      const res = await post("/auth/revoke", { token: refreshToken, token_type_hint: "refresh_token" });
      return res.ok;
    },
  };
}

const key = () => createHash("sha256").update(`${serverPepper()}:apple-refresh-token`).digest();

export function sealToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function openToken(sealed: string): string | null {
  const [v, iv, tag, enc] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !enc) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(enc, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
