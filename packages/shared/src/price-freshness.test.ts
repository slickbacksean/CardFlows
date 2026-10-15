import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRICE_STALE_MS,
  PRICE_UNAVAILABLE_ENTER_OWN_COPY,
  WATCHLIST_SAVED_MAX_BUY_META,
  priceDisplayState,
  priceQueryKey,
} from "./price-freshness";
import { pregradeCopyViolations } from "./pregrade-copy";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

type PriceBody = { ok: true; estimate: { amount: string | null } };

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`CardFlow API ${status}`);
  }
}

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

function client() {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(c);
  return c;
}

function stateOf(c: QueryClient, key: ReturnType<typeof priceQueryKey>) {
  const query = c.getQueryCache().find<PriceBody>({ queryKey: key });
  const data = query?.state.data;
  return priceDisplayState({
    estimate: data?.estimate,
    isPending: query?.state.status === "pending",
    isFetching: query?.state.fetchStatus === "fetching",
    isError: query?.state.status === "error",
  });
}

describe("prices never block (P1-02)", () => {
  it("shows checking only with nothing cached", () => {
    expect(priceDisplayState({ estimate: null, isPending: true, isFetching: true, isError: false }).kind).toBe(
      "checking",
    );
  });

  it("shows a cached price with a refresh running instead of a spinner", () => {
    expect(
      priceDisplayState({ estimate: { amount: "4.20" }, isPending: false, isFetching: true, isError: false }),
    ).toEqual({ kind: "price", refreshing: true });
  });

  it("degrades to unavailable when the API answers 500 and nothing is cached", async () => {
    const c = client();
    const key = priceQueryKey("base1-58", "normal");
    await c
      .fetchQuery<PriceBody>({ queryKey: key, queryFn: () => Promise.reject(new HttpError(500)) })
      .catch(() => undefined);
    expect(stateOf(c, key)).toEqual({ kind: "unavailable", refreshing: false });
  });

  it("keeps the cached price when a refresh hits a 500", async () => {
    const c = client();
    const key = priceQueryKey("base1-58", "normal");
    c.setQueryData<PriceBody>(key, { ok: true, estimate: { amount: "4.20" } });
    const observer = new QueryObserver<PriceBody>(c, {
      queryKey: key,
      queryFn: () => Promise.reject(new HttpError(500)),
      staleTime: 0,
    });
    await observer.refetch().catch(() => undefined);
    expect(stateOf(c, key).kind).toBe("price");
    expect(c.getQueryData<PriceBody>(key)?.estimate.amount).toBe("4.20");
  });

  it("treats a vendor 'no amount' answer as unavailable, never a $0 price", () => {
    expect(
      priceDisplayState({ estimate: { amount: null }, isPending: false, isFetching: false, isError: false }).kind,
    ).toBe("unavailable");
  });

  it("refreshes live prices after 15 minutes and keys by card + variant", () => {
    expect(PRICE_STALE_MS).toBe(15 * 60 * 1000);
    expect(priceQueryKey("a", "holo")).not.toEqual(priceQueryKey("a", "normal"));
  });

  it("copy follows the rules", () => {
    for (const text of [PRICE_UNAVAILABLE_ENTER_OWN_COPY, WATCHLIST_SAVED_MAX_BUY_META]) {
      expect(pregradeCopyViolations(text)).toEqual([]);
      expect(text).not.toMatch(/market price|profit/i);
    }
  });

  it("Confirm reads prices through React Query and prefetches on identify", () => {
    const decide = read("apps/mobile/app/decide/[cardflowCardId].tsx");
    const scan = read("apps/mobile/app/scan/[scanId].tsx");
    expect(decide).toContain("useQuery(");
    expect(decide).toContain("priceQueryOptions(");
    expect(decide).toContain("priceDisplayState(");
    expect(decide).toContain("PRICE_UNAVAILABLE_ENTER_OWN_COPY");
    expect(decide).not.toContain('marketState === "loading"');
    expect(decide).not.toMatch(/>\s*Max Buy \$\{/);
    expect(scan).toContain("prefetchCandidatePrices(queryClient");
  });
});
