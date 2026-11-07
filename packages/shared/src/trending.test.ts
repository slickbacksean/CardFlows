import { describe, expect, it } from "vitest";
import {
  computePriceDelta,
  formatSignedPercent,
  formatSignedUsd,
  pairPriceDeltas,
  previousSnapshotDate,
  pricesAsOfLabel,
  rankPopularCards,
  selectMovers,
  shouldUsePopularityFallback,
  trendingSnapshotIsStale,
  TRENDING_MIN_PRICE_CENTS,
  TRENDING_POPULARITY_ACTIVITY_LABEL,
  TRENDING_POPULARITY_FALLBACK_LABEL,
} from "./trending";

describe("price deltas", () => {
  it("computes percent and absolute change", () => {
    expect(
      computePriceDelta(
        { tcgdexId: "base1-4", variant: "holofoil", priceCents: 1100 },
        { tcgdexId: "base1-4", variant: "holofoil", priceCents: 1000 },
      ),
    ).toEqual({
      tcgdexId: "base1-4",
      variant: "holofoil",
      currentPriceCents: 1100,
      previousPriceCents: 1000,
      changeCents: 100,
      changePercent: 10,
    });
  });

  it("returns null when the previous price is missing or zero", () => {
    expect(
      computePriceDelta({ tcgdexId: "base1-4", variant: "normal", priceCents: 200 }, null),
    ).toBeNull();
    expect(
      computePriceDelta(
        { tcgdexId: "base1-4", variant: "normal", priceCents: 200 },
        { tcgdexId: "base1-4", variant: "normal", priceCents: 0 },
      ),
    ).toBeNull();
  });

  it("pairs current and previous rows by card + variant", () => {
    const deltas = pairPriceDeltas(
      [
        { tcgdexId: "a", variant: "normal", priceCents: 400 },
        { tcgdexId: "b", variant: "holofoil", priceCents: 800 },
      ],
      [
        { tcgdexId: "a", variant: "normal", priceCents: 200 },
        { tcgdexId: "b", variant: "normal", priceCents: 700 },
      ],
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ tcgdexId: "a", changePercent: 100, changeCents: 200 });
  });
});

describe("movers", () => {
  const sample = [
    computePriceDelta(
      { tcgdexId: "cheap", variant: "normal", priceCents: 150 },
      { tcgdexId: "cheap", variant: "normal", priceCents: 50 },
    )!,
    computePriceDelta(
      { tcgdexId: "up-a", variant: "holofoil", priceCents: 500 },
      { tcgdexId: "up-a", variant: "holofoil", priceCents: 250 },
    )!,
    computePriceDelta(
      { tcgdexId: "up-a", variant: "normal", priceCents: 300 },
      { tcgdexId: "up-a", variant: "normal", priceCents: 200 },
    )!,
    computePriceDelta(
      { tcgdexId: "down-a", variant: "normal", priceCents: 400 },
      { tcgdexId: "down-a", variant: "normal", priceCents: 800 },
    )!,
    computePriceDelta(
      { tcgdexId: "flat", variant: "normal", priceCents: 400 },
      { tcgdexId: "flat", variant: "normal", priceCents: 400 },
    )!,
  ];

  it("filters below the min price, keeps one variant per card, and ranks by percent", () => {
    const up = selectMovers(sample, { direction: "up", minPriceCents: TRENDING_MIN_PRICE_CENTS });
    expect(up.map((row) => row.tcgdexId)).toEqual(["up-a"]);
    expect(up[0]?.variant).toBe("holofoil");
    expect(up[0]?.changePercent).toBe(100);

    const down = selectMovers(sample, { direction: "down" });
    expect(down.map((row) => row.tcgdexId)).toEqual(["down-a"]);
    expect(down[0]?.changePercent).toBe(-50);
  });
});

describe("popularity ranking + cold start", () => {
  it("uses PokeSniper activity when the window has enough events", () => {
    const activity = Array.from({ length: 6 }, (_, i) => ({
      tcgdexId: `card-${i}`,
      scans: 3,
      mydexAdds: 1,
    }));
    expect(shouldUsePopularityFallback(activity)).toBe(false);
    const ranked = rankPopularCards(activity, [{ tcgdexId: "expensive", priceCents: 50_000 }]);
    expect(ranked.source).toBe("pokesniper_activity");
    expect(ranked.sourceLabel).toBe(TRENDING_POPULARITY_ACTIVITY_LABEL);
    expect(ranked.ranked[0]?.tcgdexId).toBe("card-0");
    expect(ranked.ranked[0]?.score).toBe(4);
  });

  it("falls back to highest-value cards and labels it honestly", () => {
    const activity = [
      { tcgdexId: "lonely", scans: 1, mydexAdds: 0 },
      { tcgdexId: "quiet", scans: 0, mydexAdds: 1 },
    ];
    expect(shouldUsePopularityFallback(activity)).toBe(true);
    const ranked = rankPopularCards(activity, [
      { tcgdexId: "charizard", priceCents: 40_000, absChangeCents: 100 },
      { tcgdexId: "charizard", priceCents: 10_000 },
      { tcgdexId: "pikachu", priceCents: 2_000, absChangeCents: 5_000 },
      { tcgdexId: "missing", priceCents: 0 },
    ]);
    expect(ranked.source).toBe("price_fallback");
    expect(ranked.sourceLabel).toBe(TRENDING_POPULARITY_FALLBACK_LABEL);
    expect(ranked.ranked.map((row) => row.tcgdexId)).toEqual(["charizard", "pikachu"]);
  });
});

describe("copy helpers", () => {
  it("formats money, percent, as-of, and stale", () => {
    expect(formatSignedUsd(125)).toBe("+$1.25");
    expect(formatSignedUsd(-50)).toBe("-$0.50");
    expect(formatSignedPercent(12.34)).toBe("+12.3%");
    expect(formatSignedPercent(-3)).toBe("\u22123.0%");
    expect(pricesAsOfLabel("2026-11-07")).toBe("Prices as of Nov 7, 2026");
    expect(pricesAsOfLabel("2026/11/06")).toBe("Prices as of Nov 6, 2026");
    expect(previousSnapshotDate("2026-11-07", "24h")).toBe("2026-11-06");
    expect(previousSnapshotDate("2026-11-07", "7d")).toBe("2026-10-31");
    expect(trendingSnapshotIsStale("2026-11-07", new Date("2026-11-07T12:00:00.000Z"))).toBe(false);
    expect(trendingSnapshotIsStale("2026-11-05", new Date("2026-11-07T12:00:00.000Z"))).toBe(true);
    expect(trendingSnapshotIsStale(null, new Date())).toBe(true);
  });
});
