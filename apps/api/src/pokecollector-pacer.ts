/**
 * Backend re-review M1 (P4): PokéCollector rate-limits per client IP (slowapi, v1.51): 60
 * requests a minute on every route and 5 logins a minute on /api/auth/login. CardFlow calls from
 * one IP, so background work (the account-deletion queue, the relink script) is paced well under
 * both, leaving room for live traffic: by default 30 requests and 2 logins a minute.
 */
export type PokecollectorPacedKind = "request" | "login";

export interface PokecollectorPacer {
  /** Waits until one more call of this kind fits in the last minute. A login also counts as a request. */
  take(kind: PokecollectorPacedKind): Promise<void>;
}

export interface PokecollectorPacerOptions {
  requestsPerMinute?: number;
  loginsPerMinute?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const POKECOLLECTOR_BACKGROUND_REQUESTS_PER_MINUTE = 30;
export const POKECOLLECTOR_BACKGROUND_LOGINS_PER_MINUTE = 2;
/** PokéCollector's own limits, for the checks in tests and docs. */
export const POKECOLLECTOR_REQUESTS_PER_MINUTE_LIMIT = 60;
export const POKECOLLECTOR_LOGINS_PER_MINUTE_LIMIT = 5;

const WINDOW_MS = 60_000;

export function createPokecollectorPacer(options: PokecollectorPacerOptions = {}): PokecollectorPacer {
  const requestsPerMinute = Math.max(1, Math.min(options.requestsPerMinute ?? POKECOLLECTOR_BACKGROUND_REQUESTS_PER_MINUTE, POKECOLLECTOR_REQUESTS_PER_MINUTE_LIMIT - 1));
  const loginsPerMinute = Math.max(1, Math.min(options.loginsPerMinute ?? POKECOLLECTOR_BACKGROUND_LOGINS_PER_MINUTE, POKECOLLECTOR_LOGINS_PER_MINUTE_LIMIT - 1));
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const requests: number[] = [];
  const logins: number[] = [];
  let chain: Promise<void> = Promise.resolve();

  const waitFor = (stamps: number[], cap: number, at: number): number => {
    while (stamps.length > 0 && stamps[0]! <= at - WINDOW_MS) stamps.shift();
    return stamps.length < cap ? 0 : stamps[0]! + WINDOW_MS - at;
  };

  async function takeNow(kind: PokecollectorPacedKind): Promise<void> {
    for (;;) {
      const at = now();
      const wait = Math.max(waitFor(requests, requestsPerMinute, at), kind === "login" ? waitFor(logins, loginsPerMinute, at) : 0);
      if (wait <= 0) {
        requests.push(at);
        if (kind === "login") logins.push(at);
        return;
      }
      await sleep(wait);
    }
  }

  return {
    take(kind) {
      // One at a time, so concurrent callers can't both see a free slot.
      const next = chain.then(() => takeNow(kind));
      chain = next.catch(() => undefined);
      return next;
    },
  };
}

/** No pacing (tests, and calls that are already paced by the caller). */
export const unpacedPokecollector: PokecollectorPacer = { take: async () => undefined };
