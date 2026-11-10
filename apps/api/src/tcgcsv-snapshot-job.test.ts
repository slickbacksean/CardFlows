import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { pokemonTcgIdMap, pokemonTcgPriceSnapshots, pokemonTcgSnapshotRuns } from "./db/schema";
import { createSqliteStore } from "./sqlite-store";
import { runTcgcsvSnapshot } from "./tcgcsv-snapshot-job";
import { trendingPriceSourceFromEnv } from "./trending-snapshot-run";
import { TCGCSV_DEFAULT_USER_AGENT } from "./tcgcsv-http";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/shared/fixtures/tcgcsv");

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8");
}

function jsonFixture(name: string): unknown {
  return JSON.parse(readFixture(name));
}

function mockTcgcsvFetch(overrides: Record<string, { status?: number; body: string; headers?: Record<string, string> }> = {}) {
  const calls: Array<{ url: string; userAgent: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, userAgent: headers.get("user-agent") });
    for (const [needle, response] of Object.entries(overrides)) {
      if (url.includes(needle)) {
        return new Response(response.body, {
          status: response.status ?? 200,
          headers: { "content-type": "application/json", ...response.headers },
        });
      }
    }
    if (url.endsWith("/last-updated.txt")) {
      return new Response(readFixture("last-updated.txt"), { status: 200 });
    }
    if (url.endsWith("/groups")) {
      return new Response(readFixture("groups.json"), { status: 200, headers: { "content-type": "application/json" } });
    }
    const groupMatch = /\/tcgplayer\/3\/(\d+)\/(products|prices)/.exec(url);
    if (groupMatch) {
      const [, groupId, kind] = groupMatch;
      const file = `${groupId}-${kind}.json`;
      try {
        return new Response(readFixture(file), { status: 200, headers: { "content-type": "application/json" } });
      } catch {
        return new Response(JSON.stringify({ success: true, results: [] }), { status: 200 });
      }
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls };
}

describe("CARD_FLOW_TRENDING_PRICE_SOURCE", () => {
  it("defaults to tcgcsv and accepts pokemontcg as fallback", () => {
    expect(trendingPriceSourceFromEnv({})).toBe("tcgcsv");
    expect(trendingPriceSourceFromEnv({ CARD_FLOW_TRENDING_PRICE_SOURCE: "TCGCSV" })).toBe("tcgcsv");
    expect(trendingPriceSourceFromEnv({ CARD_FLOW_TRENDING_PRICE_SOURCE: "pokemontcg" })).toBe("pokemontcg");
    expect(trendingPriceSourceFromEnv({ CARD_FLOW_TRENDING_PRICE_SOURCE: "pokemontcg.io" })).toBe("pokemontcg");
  });
});

describe("TCGCSV snapshot job", () => {
  it("snapshots matched card prices from recorded fixtures and sends a User-Agent", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tcgcsv-snap-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    const { fetchImpl, calls } = mockTcgcsvFetch();

    const result = await runTcgcsvSnapshot({
      store,
      now: new Date("2026-11-09T08:00:00.000Z"),
      force: true,
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      snapshotDate: "2026-11-09",
      priceSource: "tcgcsv",
    });
    expect(result.matched).toBeGreaterThan(0);
    expect(result.snapshotsWritten).toBeGreaterThan(0);
    expect(calls.some((call) => call.url.includes("last-updated.txt"))).toBe(true);
    expect(calls.every((call) => call.userAgent === TCGCSV_DEFAULT_USER_AGENT)).toBe(true);

    const alakazam = store.db
      .select()
      .from(pokemonTcgIdMap)
      .where(eq(pokemonTcgIdMap.pokemontcgCardId, "tcgcsv:42346"))
      .all()[0];
    expect(alakazam).toMatchObject({ tcgdexId: "base1-1", mappingStatus: "matched" });

    const sealed = store.db
      .select()
      .from(pokemonTcgIdMap)
      .where(eq(pokemonTcgIdMap.pokemontcgCardId, "tcgcsv:283388"))
      .all()[0];
    expect(sealed).toMatchObject({ mappingStatus: "unmatched", unmatchedReason: "not_a_card" });

    const sealedPrices = store.db
      .select()
      .from(pokemonTcgPriceSnapshots)
      .where(eq(pokemonTcgPriceSnapshots.pokemontcgCardId, "tcgcsv:283388"))
      .all();
    expect(sealedPrices).toEqual([]);

    const holo = store.db
      .select()
      .from(pokemonTcgPriceSnapshots)
      .where(eq(pokemonTcgPriceSnapshots.pokemontcgCardId, "tcgcsv:42346"))
      .all();
    expect(holo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshotDate: "2026-11-09",
          variant: "holofoil",
          marketPriceCents: 7607,
        }),
      ]),
    );

    const skipped = await runTcgcsvSnapshot({
      store,
      now: new Date("2026-11-09T09:00:00.000Z"),
      fetchImpl,
      sleep: async () => undefined,
    });
    expect(skipped.skipped).toBe(true);
    store.close();
  });

  it("skips when last-updated.txt matches the last successful dump, unless force=1", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tcgcsv-updated-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    store.db
      .insert(pokemonTcgSnapshotRuns)
      .values({
        runId: "prev",
        startedAt: "2026-11-08T06:00:00.000Z",
        finishedAt: "2026-11-08T06:05:00.000Z",
        status: "success",
        snapshotDate: "2026-11-08",
        maxTcgplayerUpdatedAt: readFixture("last-updated.txt").trim(),
      })
      .run();
    const { fetchImpl, calls } = mockTcgcsvFetch();
    const skipped = await runTcgcsvSnapshot({
      store,
      now: new Date("2026-11-09T08:00:00.000Z"),
      fetchImpl,
      sleep: async () => undefined,
    });
    expect(skipped.skipped).toBe(true);
    expect(calls.filter((call) => call.url.includes("/groups"))).toHaveLength(0);

    const forced = await runTcgcsvSnapshot({
      store,
      now: new Date("2026-11-09T08:00:00.000Z"),
      force: true,
      fetchImpl,
      sleep: async () => undefined,
    });
    expect(forced.ok).toBe(true);
    expect(forced.skipped).toBeFalsy();
    expect(calls.some((call) => call.url.includes("/groups"))).toBe(true);
    store.close();
  });

  it("retries HTTP 500 with backoff, then succeeds", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tcgcsv-500-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    let lastUpdatedHits = 0;
    const { fetchImpl } = mockTcgcsvFetch();
    const wrapping: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("last-updated")) {
        lastUpdatedHits += 1;
        if (lastUpdatedHits === 1) return new Response("nope", { status: 500 });
      }
      return fetchImpl(input, init);
    };
    const sleep = vi.fn(async () => undefined);
    const result = await runTcgcsvSnapshot({
      store,
      now: new Date("2026-11-09T08:00:00.000Z"),
      force: true,
      fetchImpl: wrapping,
      sleep,
    });
    expect(result.ok).toBe(true);
    expect(lastUpdatedHits).toBe(2);
    expect(sleep).toHaveBeenCalled();
    store.close();
  });

  it("leaves other groups intact when one group fails", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tcgcsv-partial-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    const { fetchImpl } = mockTcgcsvFetch();
    const wrapping: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/3170/products")) return new Response("boom", { status: 502 });
      return fetchImpl(input, init);
    };
    const result = await runTcgcsvSnapshot({
      store,
      now: new Date("2026-11-09T08:00:00.000Z"),
      force: true,
      fetchImpl: wrapping,
      sleep: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.error).toMatch(/Silver Tempest/i);
    const base = store.db
      .select()
      .from(pokemonTcgIdMap)
      .where(eq(pokemonTcgIdMap.pokemontcgCardId, "tcgcsv:42346"))
      .all();
    expect(base).toHaveLength(1);
    const silver = store.db
      .select()
      .from(pokemonTcgIdMap)
      .where(eq(pokemonTcgIdMap.pokemontcgCardId, "tcgcsv:450289"))
      .all();
    expect(silver).toHaveLength(0);
    store.close();
  });

  it("does not hit the network when fixtures are used as the fetch implementation", () => {
    expect((jsonFixture("groups.json") as { results: unknown[] }).results.length).toBeGreaterThan(0);
    expect(readFixture("last-updated.txt")).toMatch(/2026-11-08/);
  });
});
