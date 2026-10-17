/**
 * Open sign-up passwords: scrypt (node:crypto, no native add-on), per-password salt,
 * constant-time compare. Backend review L2: N = 2^17 (r 8, p 1). The parameters are stored
 * with each hash, so older hashes keep verifying and N can be raised later.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

export const SCRYPT_DEFAULT_N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** Tests may lower N (CARD_FLOW_SCRYPT_N) to stay fast; production uses the default. */
export function scryptN(env: NodeJS.Dict<string | undefined> = process.env): number {
  const raw = Number(env.CARD_FLOW_SCRYPT_N);
  if (env.NODE_ENV !== "production" && Number.isInteger(raw) && raw >= 2 ** 10 && (raw & (raw - 1)) === 0) return raw;
  return SCRYPT_DEFAULT_N;
}

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  const n = options.N ?? SCRYPT_DEFAULT_N;
  const r = options.r ?? R;
  // scrypt needs about 128 * N * r bytes; Node's default 32 MB cap is too small for 2^17.
  const maxmem = 128 * n * r * 2;
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, KEYLEN, { ...options, maxmem }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export async function hashPassword(password: string, n: number = scryptN()): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, { N: n, r: R, p: P });
  return `scrypt$${n}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const N = Number(n);
  // Stored params are server-written; still refuse absurd values.
  if (!Number.isInteger(N) || N < 2 ** 10 || N > 2 ** 20) return false;
  const expected = Buffer.from(keyB64!, "base64");
  const key = await scrypt(password, Buffer.from(saltB64!, "base64"), { N, r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Burns the same work as a real check so unknown emails take as long as wrong passwords. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  const dummy = `scrypt$${scryptN()}$${R}$${P}$AAAAAAAAAAAAAAAAAAAAAA==$${Buffer.alloc(KEYLEN).toString("base64")}`;
  await verifyPassword(password, dummy);
  return false;
}
