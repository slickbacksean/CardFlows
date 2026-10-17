import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * PokéCollector opaque per-user accounts. Each CardFlow user gets their own PokéCollector user:
 * - username `cardflow-u-<base32(HMAC-SHA256(userId, pepper))[:20]>`, never derived from the
 *   email or label, so two users can't land on one remote user;
 * - a random per-link password, stored only encrypted (AES-256-GCM, bound to the CardFlow user ID).
 * Both secrets are required. There is no fallback (no admin token, no built-in value): when either
 * is missing, PokéCollector accounts stay off (fail closed).
 */
export const POKECOLLECTOR_USER_PEPPER_ENV = "CARD_FLOW_POKECOLLECTOR_USER_PEPPER";
export const POKECOLLECTOR_LINK_KEY_ENV = "CARD_FLOW_POKECOLLECTOR_LINK_KEY";
export const POKECOLLECTOR_USER_PEPPER_MIN_LENGTH = 32;
export const OPAQUE_USERNAME_PREFIX = "cardflow-u-";
const OPAQUE_USERNAME_HASH_CHARS = 20;
const CIPHERTEXT_VERSION = "v1";
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export interface PokecollectorLinkSecrets {
  userPepper: string;
  /** 32-byte AES-256-GCM key. */
  linkKey: Buffer;
}

export class PokecollectorSecretsMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PokecollectorSecretsMissingError";
  }
}

/** RFC 4648 base32, lowercase, no padding. */
export function base32Lower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function opaquePokecollectorUsername(userId: string, userPepper: string): string {
  if (!userPepper) throw new PokecollectorSecretsMissingError(`${POKECOLLECTOR_USER_PEPPER_ENV} is required`);
  const digest = createHmac("sha256", userPepper).update(userId, "utf8").digest();
  return `${OPAQUE_USERNAME_PREFIX}${base32Lower(digest).slice(0, OPAQUE_USERNAME_HASH_CHARS)}`;
}

export function isOpaquePokecollectorUsername(username: string): boolean {
  return new RegExp(`^${OPAQUE_USERNAME_PREFIX}[a-z2-7]{${OPAQUE_USERNAME_HASH_CHARS}}$`).test(username);
}

/** A fresh random password for one link (never derived from anything). */
export function randomPokecollectorPassword(): string {
  return `cf-${randomBytes(24).toString("base64url")}`;
}

export function encryptLinkPassword(password: string, userId: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`cardflow-pokecollector-link\0${userId}`, "utf8"));
  const body = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return `${CIPHERTEXT_VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** Throws if the ciphertext was changed or belongs to another CardFlow user. */
export function decryptLinkPassword(ciphertext: string, userId: string, key: Buffer): string {
  const [version, payload] = ciphertext.split(":");
  if (version !== CIPHERTEXT_VERSION || !payload) throw new Error("Unknown PokéCollector link ciphertext");
  const raw = Buffer.from(payload, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(`cardflow-pokecollector-link\0${userId}`, "utf8"));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

function parseKey(value: string): Buffer | null {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  const decoded = Buffer.from(trimmed, "base64");
  return decoded.length === 32 ? decoded : null;
}

/** Null plus the reason when either secret is missing or malformed. */
export function pokecollectorLinkSecretsFromEnv(
  env: NodeJS.Dict<string | undefined>,
): { secrets: PokecollectorLinkSecrets; problem: null } | { secrets: null; problem: string } {
  const userPepper = env[POKECOLLECTOR_USER_PEPPER_ENV]?.trim() ?? "";
  if (userPepper.length < POKECOLLECTOR_USER_PEPPER_MIN_LENGTH) {
    return { secrets: null, problem: `${POKECOLLECTOR_USER_PEPPER_ENV} unset or shorter than ${POKECOLLECTOR_USER_PEPPER_MIN_LENGTH} characters` };
  }
  const linkKey = parseKey(env[POKECOLLECTOR_LINK_KEY_ENV] ?? "");
  if (!linkKey) {
    return { secrets: null, problem: `${POKECOLLECTOR_LINK_KEY_ENV} unset or not a 32-byte key (64 hex or base64)` };
  }
  return { secrets: { userPepper, linkKey }, problem: null };
}

export function requireLinkSecrets(secrets: Partial<PokecollectorLinkSecrets> | undefined): PokecollectorLinkSecrets {
  if (!secrets?.userPepper || secrets.userPepper.length < POKECOLLECTOR_USER_PEPPER_MIN_LENGTH) {
    throw new PokecollectorSecretsMissingError(`${POKECOLLECTOR_USER_PEPPER_ENV} is required (no fallback)`);
  }
  if (!secrets.linkKey || secrets.linkKey.length !== 32) {
    throw new PokecollectorSecretsMissingError(`${POKECOLLECTOR_LINK_KEY_ENV} is required (no fallback)`);
  }
  return { userPepper: secrets.userPepper, linkKey: secrets.linkKey };
}
