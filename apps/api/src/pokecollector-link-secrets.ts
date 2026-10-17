import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

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
/** Re-review L2: earlier link keys, comma-separated, still read (never written) during a rotation. */
export const POKECOLLECTOR_PREVIOUS_LINK_KEYS_ENV = "CARD_FLOW_POKECOLLECTOR_PREVIOUS_LINK_KEYS";
export const POKECOLLECTOR_USER_PEPPER_MIN_LENGTH = 32;
export const OPAQUE_USERNAME_PREFIX = "cardflow-u-";
const OPAQUE_USERNAME_HASH_CHARS = 20;
/**
 * Re-review L2: `v2:<key id>:<base64url(iv 12 | tag 16 | ciphertext)>`. The key ID (a fingerprint
 * of the key, not secret) says which key to use, so the key can be rotated. `v1:<payload>` (no key
 * ID) is still read, trying each key.
 */
const CIPHERTEXT_VERSION = "v2";
const LEGACY_CIPHERTEXT_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** iv + tag: anything shorter can't be a real payload. */
export const MIN_LINK_PAYLOAD_BYTES = IV_BYTES + TAG_BYTES;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export interface PokecollectorLinkSecrets {
  userPepper: string;
  /** 32-byte AES-256-GCM key. New ciphertexts always use this one. */
  linkKey: Buffer;
  /** Re-review L2: earlier keys, only for reading links written before a rotation. */
  previousLinkKeys?: readonly Buffer[];
}

/** Every key a link may be encrypted with, current first. */
export function linkKeysOf(secrets: Pick<PokecollectorLinkSecrets, "linkKey" | "previousLinkKeys">): Buffer[] {
  return [secrets.linkKey, ...(secrets.previousLinkKeys ?? [])];
}

/** Re-review L2: a short public fingerprint of a key (not the key). */
export function linkKeyId(key: Buffer): string {
  return createHash("sha256").update("cardflow-pokecollector-link-key-id\0").update(key).digest("base64url").slice(0, 8);
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

const aad = (userId: string) => Buffer.from(`cardflow-pokecollector-link\0${userId}`, "utf8");

export function encryptLinkPassword(password: string, userId: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(userId));
  const body = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return `${CIPHERTEXT_VERSION}:${linkKeyId(key)}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

function decryptWith(raw: Buffer, userId: string, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
  decipher.setAAD(aad(userId));
  decipher.setAuthTag(raw.subarray(IV_BYTES, MIN_LINK_PAYLOAD_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(MIN_LINK_PAYLOAD_BYTES)), decipher.final()]).toString("utf8");
}

/**
 * Throws if the ciphertext was changed, is too short, belongs to another CardFlow user, or was
 * written with a key that isn't configured. `keys`: the current key, or every key (current first).
 */
export function decryptLinkPassword(ciphertext: string, userId: string, keys: Buffer | readonly Buffer[]): string {
  const all = Buffer.isBuffer(keys) ? [keys] : [...keys];
  const parts = ciphertext.split(":");
  const version = parts[0];
  const payload = version === CIPHERTEXT_VERSION ? parts[2] : version === LEGACY_CIPHERTEXT_VERSION ? parts[1] : undefined;
  const expectedParts = version === CIPHERTEXT_VERSION ? 3 : 2;
  if (!payload || parts.length !== expectedParts) throw new Error("Unknown PokéCollector link ciphertext");
  const raw = Buffer.from(payload, "base64url");
  if (raw.length < MIN_LINK_PAYLOAD_BYTES) throw new Error("PokéCollector link ciphertext too short");
  if (version === CIPHERTEXT_VERSION) {
    const key = all.find((k) => linkKeyId(k) === parts[1]);
    if (!key) throw new Error("PokéCollector link key not configured (see CARD_FLOW_POKECOLLECTOR_PREVIOUS_LINK_KEYS)");
    return decryptWith(raw, userId, key);
  }
  for (const key of all) {
    try {
      return decryptWith(raw, userId, key);
    } catch {
      // next key
    }
  }
  throw new Error("PokéCollector link ciphertext does not decrypt with any configured key");
}

/** Re-review L2: true when a link isn't on the current key and format (re-encrypt it). */
export function linkCiphertextNeedsRotation(ciphertext: string, currentKey: Buffer): boolean {
  const parts = ciphertext.split(":");
  return parts[0] !== CIPHERTEXT_VERSION || parts[1] !== linkKeyId(currentKey);
}

/** Re-review L2: the same password under the current key (for a key rotation). */
export function reencryptLinkPassword(ciphertext: string, userId: string, secrets: PokecollectorLinkSecrets): string {
  return encryptLinkPassword(decryptLinkPassword(ciphertext, userId, linkKeysOf(secrets)), userId, secrets.linkKey);
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
  const previousLinkKeys: Buffer[] = [];
  for (const value of (env[POKECOLLECTOR_PREVIOUS_LINK_KEYS_ENV] ?? "").split(",").map((v) => v.trim()).filter(Boolean)) {
    const key = parseKey(value);
    if (!key) return { secrets: null, problem: `${POKECOLLECTOR_PREVIOUS_LINK_KEYS_ENV} has a value that is not a 32-byte key` };
    previousLinkKeys.push(key);
  }
  return { secrets: { userPepper, linkKey, previousLinkKeys }, problem: null };
}

export function requireLinkSecrets(secrets: Partial<PokecollectorLinkSecrets> | undefined): PokecollectorLinkSecrets {
  if (!secrets?.userPepper || secrets.userPepper.length < POKECOLLECTOR_USER_PEPPER_MIN_LENGTH) {
    throw new PokecollectorSecretsMissingError(`${POKECOLLECTOR_USER_PEPPER_ENV} is required (no fallback)`);
  }
  if (!secrets.linkKey || secrets.linkKey.length !== 32) {
    throw new PokecollectorSecretsMissingError(`${POKECOLLECTOR_LINK_KEY_ENV} is required (no fallback)`);
  }
  for (const key of secrets.previousLinkKeys ?? []) {
    if (key.length !== 32) throw new PokecollectorSecretsMissingError(`${POKECOLLECTOR_PREVIOUS_LINK_KEYS_ENV} keys must be 32 bytes`);
  }
  return { userPepper: secrets.userPepper, linkKey: secrets.linkKey, previousLinkKeys: secrets.previousLinkKeys ?? [] };
}
