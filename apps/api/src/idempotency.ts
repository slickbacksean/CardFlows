/**
 * Backend review: request idempotency for replayed offline writes.
 * - Replays are found before any limit check.
 * - The body hash is stored; the same key with a different body is a 422.
 * - Concurrent requests with the same key share one in-flight run (recognition runs once).
 * - Keys expire after 24 hours.
 */
import { createHash } from "node:crypto";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

interface Entry<T> {
  bodyHash: string | null;
  at: number;
  result?: T;
  inflight?: Promise<T | undefined>;
}

export function hashRequestBody(parts: Array<string | Uint8Array | null | undefined>): string {
  const h = createHash("sha256");
  for (const part of parts) {
    h.update(part == null ? "\0null" : typeof part === "string" ? `\0s${part}` : Buffer.from(part));
    h.update("\0|");
  }
  return h.digest("hex");
}

export type IdempotencyLookup<T> =
  | { kind: "new"; finish: (bodyHash: string, result: T | undefined) => void; setHash: (bodyHash: string) => void }
  | { kind: "replay"; entry: { bodyHash: string | null; result?: T }; wait: () => Promise<T | undefined> };

export function createIdempotencyRegistry<T>(now: () => number = Date.now, max = 50_000) {
  const entries = new Map<string, Entry<T>>();
  function prune() {
    const cutoff = now() - IDEMPOTENCY_TTL_MS;
    for (const [key, entry] of entries) {
      if (entry.at < cutoff && !entry.inflight) entries.delete(key);
    }
    while (entries.size > max) entries.delete(entries.keys().next().value!);
  }
  return {
    /** Synchronous: claims the key (in-flight) if unseen, or returns the replay. */
    claim(key: string): IdempotencyLookup<T> {
      const existing = entries.get(key);
      if (existing && now() - existing.at < IDEMPOTENCY_TTL_MS) {
        return {
          kind: "replay",
          entry: existing,
          wait: async () => (existing.inflight ? await existing.inflight : existing.result),
        };
      }
      let resolve!: (value: T | undefined) => void;
      const entry: Entry<T> = { bodyHash: null, at: now() };
      entry.inflight = new Promise<T | undefined>((r) => (resolve = r));
      entries.set(key, entry);
      if (entries.size > max) prune();
      return {
        kind: "new",
        setHash: (bodyHash) => {
          entry.bodyHash = bodyHash;
        },
        finish: (bodyHash, result) => {
          entry.bodyHash = bodyHash;
          entry.result = result;
          entry.inflight = undefined;
          // A failed run frees the key so the client can retry.
          if (result === undefined) entries.delete(key);
          resolve(result);
        },
      };
    },
    /** True when the key is in flight or answered within 24 h (a replay, not a new request). */
    peek(key: string): boolean {
      const existing = entries.get(key);
      return Boolean(existing && now() - existing.at < IDEMPOTENCY_TTL_MS);
    },
    prune,
    /** Backend review L1: account deletion drops every key that starts with `${userId}\0`. */
    purgePrefix(prefix: string): number {
      let n = 0;
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) {
          entries.delete(key);
          n += 1;
        }
      }
      return n;
    },
    size: () => entries.size,
  };
}
