import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FEATURE_DISABLED_CODE, TRENDING_DISABLED_COPY } from "@cardflow/shared";
import { createApp } from "./app";
import { cardflowCards, crmScans, pokemonTcgIdMap, pokemonTcgPriceSnapshots, pokemonTcgSnapshotRuns } from "./db/schema";
import { createMemoryStore } from "./store";
import { createSqliteStore } from "./sqlite-store";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seedPrices(store: ReturnType<typeof createSqliteStore>) {
  store.db
    .insert(pokemonTcgSnapshotRuns)
    .values({
      runId: "run-1",
      startedAt: "2026-11-07T06:00:00.000Z",
      finishedAt: "2026-11-07T06:05:00.000Z",
      status: "success",
      snapshotDate: "2026-11-07",
      maxTcgplayerUpdatedAt: "2026/11/06",
    })
    .run();
  store.db
    .insert(pokemonTcgIdMap)
    .values([
      {
        pokemontcgCardId: "base1-4",
        tcgdexId: "base1-4",
        mappingStatus: "matched",
        mappingMethod: "exact_id",
        name: "Charmander",
        setName: "Base",
        number: "4",
        imageUrl: "https://images.pokemontcg.io/base1/4.png",
        updatedAt: "2026-11-07T06:00:00.000Z",
      },
      {
        pokemontcgCardId: "base1-58",
        tcgdexId: "base1-58",
        mappingStatus: "matched",
        mappingMethod: "exact_id",
        name: "Pikachu",
        setName: "Base",
        number: "58",
        updatedAt: "2026-11-07T06:00:00.000Z",
      },
      {
        pokemontcgCardId: "zz-1",
        tcgdexId: null,
        mappingStatus: "unmatched",
        mappingMethod: "unmatched",
        unmatchedReason: "unknown_set:zz",
        updatedAt: "2026-11-07T06:00:00.000Z",
      },
    ])
    .run();
  store.db
    .insert(pokemonTcgPriceSnapshots)
    .values([
      { pokemontcgCardId: "base1-4", snapshotDate: "2026-11-07", variant: "holofoil", marketPriceCents: 1500, tcgplayerUpdatedAt: "2026/11/06" },
      { pokemontcgCardId: "base1-4", snapshotDate: "2026-11-06", variant: "holofoil", marketPriceCents: 1000, tcgplayerUpdatedAt: "2026/11/05" },
      { pokemontcgCardId: "base1-58", snapshotDate: "2026-11-07", variant: "normal", marketPriceCents: 400, tcgplayerUpdatedAt: "2026/11/06" },
      { pokemontcgCardId: "base1-58", snapshotDate: "2026-11-06", variant: "normal", marketPriceCents: 800, tcgplayerUpdatedAt: "2026/11/05" },
    ])
    .run();
}

describe("trending API", () => {
  it("returns 503 feature_disabled when the flag is off", async () => {
    const app = createApp(createMemoryStore(), { trendingEnabled: () => false, devAutoSession: true });
    const response = await app.request("/v1/trending");
    expect(response.status).toBe(503);
    expect(response.headers.get("x-cardflow-feature-disabled")).toBe("trending");
    const body = (await response.json()) as { code?: string; feature?: string; error?: string };
    expect(body.code).toBe(FEATURE_DISABLED_CODE);
    expect(body.feature).toBe("trending");
    expect(body.error).toBe(TRENDING_DISABLED_COPY);
  });

  it("reports the trending flag on /v1/status", async () => {
    const on = createApp(createMemoryStore(), { trendingEnabled: () => true });
    const onBody = (await (await on.request("/v1/status")).json()) as { features?: { trending?: boolean } };
    expect(onBody.features?.trending).toBe(true);
    const off = createApp(createMemoryStore(), { trendingEnabled: () => false });
    const offBody = (await (await off.request("/v1/status")).json()) as { features?: { trending?: boolean } };
    expect(offBody.features?.trending).toBe(false);
  });

  it("returns movers, a price-fallback popularity list, unmatched count, and prices as of", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trending-api-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    seedPrices(store);
    const app = createApp(store, { trendingEnabled: () => true, devAutoSession: true });
    const response = await app.request("/v1/trending?window=24h&limit=10");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      window: string;
      pricesAsOf: string | null;
      snapshotDate: string | null;
      popularity: { source: string; sourceLabel: string; cards: Array<{ tcgdexId: string }> };
      movers: { up: Array<{ tcgdexId: string; changePercent: number; changeUsd: string }>; down: Array<{ tcgdexId: string }> };
      unmatchedCount: number;
      attribution: { pokemontcg: string };
    };
    expect(body.ok).toBe(true);
    expect(body.window).toBe("24h");
    expect(body.snapshotDate).toBe("2026-11-07");
    expect(body.pricesAsOf).toBe("2026-11-06");
    expect(body.unmatchedCount).toBe(1);
    expect(body.popularity.source).toBe("price_fallback");
    expect(body.popularity.sourceLabel).toMatch(/not enough PokeSniper activity/i);
    expect(body.popularity.cards[0]?.tcgdexId).toBe("base1-4");
    expect(body.movers.up[0]).toMatchObject({ tcgdexId: "base1-4", changePercent: 50, changeUsd: "+$5.00" });
    expect(body.movers.down[0]?.tcgdexId).toBe("base1-58");
    expect(body.attribution.pokemontcg).toMatch(/pokemontcg\.io/);
    store.close();
  });

  it("returns an empty payload when the store has no SQLite snapshots", async () => {
    const app = createApp(createMemoryStore(), { trendingEnabled: () => true, devAutoSession: true });
    const response = await app.request("/v1/trending?window=24h");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      popularity: { source: string; cards: unknown[] };
      movers: { up: unknown[]; down: unknown[] };
      stale: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.popularity.source).toBe("price_fallback");
    expect(body.popularity.cards).toEqual([]);
    expect(body.movers.up).toEqual([]);
    expect(body.movers.down).toEqual([]);
    expect(body.stale).toBe(true);
  });

  it("ranks popularity from anonymous scans when the window is busy enough", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trending-act-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    seedPrices(store);
    const capturedAt = new Date().toISOString();
    const ids = ["base1-4", "base1-58", "base1-1", "base1-2", "base1-3"];
    store.db
      .insert(cardflowCards)
      .values(
        ids.map((tcgdexId) => ({
          cardflowCardId: `card-${tcgdexId}`,
          language: "en",
          tcgdexId,
          tcgdexSetId: "base1",
          localId: tcgdexId.split("-")[1] ?? tcgdexId,
          name: tcgdexId,
          setName: "Base",
          category: "Pokemon",
          variantsJson: "{}",
          updatedAt: capturedAt,
        })),
      )
      .run();
    store.db
      .insert(crmScans)
      .values(
        ids.flatMap((tcgdexId) =>
          Array.from({ length: 4 }, (_, n) => ({
            scanId: `scan-${tcgdexId}-${n}`,
            userId: `user-${n}`,
            capturedAt,
            captureMethod: "camera",
            recognitionJson: "{}",
            cardflowCardId: `card-${tcgdexId}`,
          })),
        ),
      )
      .run();
    store.db
      .insert(crmScans)
      .values({
        scanId: "scan-base1-4-extra",
        userId: "user-extra",
        capturedAt,
        captureMethod: "camera",
        recognitionJson: "{}",
        cardflowCardId: "card-base1-4",
      })
      .run();
    const app = createApp(store, { trendingEnabled: () => true, devAutoSession: true });
    const response = await app.request("/v1/trending?window=24h&limit=10");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      popularity: { source: string; sourceLabel: string; cards: Array<{ tcgdexId: string; activityCount?: number }> };
    };
    expect(body.popularity.source).toBe("pokesniper_activity");
    expect(body.popularity.sourceLabel).toMatch(/PokeSniper/i);
    expect(body.popularity.cards[0]).toMatchObject({ tcgdexId: "base1-4", activityCount: 5 });
    store.close();
  });

  it("runs the ops snapshot behind the ops token", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trending-ops-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ data: [], page: 1, pageSize: 250, count: 0, totalCount: 0 }), { status: 200 });
    const app = createApp(store, {
      trendingEnabled: () => true,
      opsToken: "ops-secret",
      pokemonTcgFetch: fetchImpl,
    });
    const missing = await app.request("/ops/trending/snapshot", { method: "POST" });
    expect(missing.status).toBe(401);
    const ok = await app.request("/ops/trending/snapshot?force=1", {
      method: "POST",
      headers: { authorization: "Bearer ops-secret" },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ok: boolean; status: string; snapshotDate?: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("success");
    store.close();
  });
});
