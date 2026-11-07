import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { pokemonTcgIdMap, pokemonTcgPriceSnapshots } from "./db/schema";
import {
  runPokemonTcgSnapshot,
  trendingSnapshotEnabledFromEnv,
} from "./pokemon-tcg-snapshot-job";
import { createSqliteStore } from "./sqlite-store";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function page(cards: unknown[], totalCount = cards.length) {
  return {
    data: cards,
    page: 1,
    pageSize: cards.length || 250,
    count: cards.length,
    totalCount,
  };
}

function mockFetch(pages: unknown[]) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    const pageNum = Number(new URL(url).searchParams.get("page") ?? "1");
    const body = pages[pageNum - 1] ?? page([]);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

describe("pokemontcg.io snapshot job", () => {
  it("reads CARD_FLOW_TRENDING_SNAPSHOT_ENABLED and falls back to the trending flag", () => {
    expect(trendingSnapshotEnabledFromEnv({})).toBe(false);
    expect(trendingSnapshotEnabledFromEnv({ CARD_FLOW_TRENDING_ENABLED: "true" })).toBe(true);
    expect(trendingSnapshotEnabledFromEnv({ CARD_FLOW_TRENDING_SNAPSHOT_ENABLED: "false", CARD_FLOW_TRENDING_ENABLED: "true" })).toBe(false);
    expect(trendingSnapshotEnabledFromEnv({ CARD_FLOW_TRENDING_SNAPSHOT_ENABLED: "on" })).toBe(true);
  });

  it("snapshots market prices, maps ids, and never puts the API key on the query string", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trending-snap-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    const { fetchImpl, calls } = mockFetch([
      page([
        {
          id: "base1-4",
          name: "Charmander",
          number: "4",
          set: { id: "base1", name: "Base" },
          images: { small: "https://images.pokemontcg.io/base1/4.png" },
          tcgplayer: {
            updatedAt: "2026/11/06",
            prices: { holofoil: { market: 12.5 }, normal: { market: 3.2 } },
          },
        },
        {
          id: "sv1-1",
          name: "Sprigatito",
          number: "1",
          set: { id: "sv1", name: "Scarlet & Violet" },
          tcgplayer: { updatedAt: "2026/11/05", prices: { reverseHolofoil: { market: 1.1 } } },
        },
        {
          id: "broken",
          name: "???",
          tcgplayer: { prices: { normal: { market: 9 } } },
        },
      ]),
    ]);

    const result = await runPokemonTcgSnapshot({
      store,
      now: new Date("2026-11-07T08:00:00.000Z"),
      force: true,
      apiKey: "super-secret-key",
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      snapshotDate: "2026-11-07",
      cardsSeen: 3,
      snapshotsWritten: 4,
      matched: 2,
      unmatched: 1,
      maxTcgplayerUpdatedAt: "2026/11/06",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("select=");
    expect(calls[0]?.url).not.toContain("super-secret-key");
    expect(calls[0]?.headers.get("X-Api-Key")).toBe("super-secret-key");

    const snapshots = store.db.select().from(pokemonTcgPriceSnapshots).all();
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pokemontcgCardId: "base1-4",
          snapshotDate: "2026-11-07",
          variant: "holofoil",
          marketPriceCents: 1250,
        }),
        expect.objectContaining({
          pokemontcgCardId: "sv1-1",
          variant: "reverseHolofoil",
          marketPriceCents: 110,
        }),
      ]),
    );

    const mapped = store.db
      .select()
      .from(pokemonTcgIdMap)
      .where(eq(pokemonTcgIdMap.pokemontcgCardId, "sv1-1"))
      .all()[0];
    expect(mapped).toMatchObject({ tcgdexId: "sv01-001", mappingStatus: "matched" });
    const unmatched = store.db
      .select()
      .from(pokemonTcgIdMap)
      .where(eq(pokemonTcgIdMap.pokemontcgCardId, "broken"))
      .all()[0];
    expect(unmatched).toMatchObject({ mappingStatus: "unmatched", unmatchedReason: "id_unparseable" });

    const skipped = await runPokemonTcgSnapshot({
      store,
      now: new Date("2026-11-07T09:00:00.000Z"),
      fetchImpl,
      sleep: async () => undefined,
    });
    expect(skipped.skipped).toBe(true);
    store.close();
  });

  it("retries on HTTP 429 using Retry-After and then succeeds", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trending-429-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    let hits = 0;
    const fetchImpl: typeof fetch = async () => {
      hits += 1;
      if (hits === 1) {
        return new Response("slow down", { status: 429, headers: { "retry-after": "1" } });
      }
      return new Response(
        JSON.stringify(
          page([
            {
              id: "base1-58",
              number: "58",
              set: { id: "base1", name: "Base" },
              tcgplayer: { prices: { holofoil: { market: 2.5 } } },
            },
          ]),
        ),
        { status: 200 },
      );
    };
    const sleep = vi.fn(async () => undefined);
    const result = await runPokemonTcgSnapshot({
      store,
      now: new Date("2026-11-07T08:00:00.000Z"),
      force: true,
      fetchImpl,
      sleep,
    });
    expect(result.ok).toBe(true);
    expect(hits).toBe(2);
    expect(sleep).toHaveBeenCalled();
    store.close();
  });
});
