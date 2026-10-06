import { describe, expect, it } from "vitest";
import {
  applyGradedMarketSummary,
  emptySlabEstimate,
  hasPrepareGradedAmounts,
  parsePoketraceRawTier,
  parsePoketraceTier,
  PREPARE_RAW_ROWS,
  PREPARE_SLAB_ROWS,
  SLAB_PRICE_DISCLAIMER,
  SLAB_PRICE_EMPTY_COPY,
  slabEstimatesFromPoketracePrices,
  typicalGradingFeeNote,
} from "./slab-pricing";

describe("PokeTrace tier parse", () => {
  it("maps normalized graded tiers", () => {
    expect(parsePoketraceTier("PSA_10")).toEqual({ company: "PSA", grade: "10" });
    expect(parsePoketraceTier("psa-9")).toEqual({ company: "PSA", grade: "9" });
    expect(parsePoketraceTier("BGS_9_5")).toEqual({ company: "BGS", grade: "9.5" });
    expect(parsePoketraceTier("BGS_9.5")).toEqual({ company: "BGS", grade: "9.5" });
    expect(parsePoketraceTier("CGC_10")).toEqual({ company: "CGC", grade: "10" });
    expect(parsePoketraceTier("TAG_10")).toEqual({ company: "TAG", grade: "10" });
  });

  it("maps Free-plan raw condition tiers and ignores unknown companies", () => {
    expect(parsePoketraceRawTier("NEAR_MINT")).toBe("NM");
    expect(parsePoketraceRawTier("lightly-played")).toBe("LP");
    expect(parsePoketraceRawTier("MODERATELY_PLAYED")).toBe("MP");
    expect(parsePoketraceRawTier("HEAVILY_PLAYED")).toBe("HP");
    expect(parsePoketraceRawTier("DAMAGED")).toBe("DMG");
    expect(parsePoketraceTier("NEAR_MINT")).toBeNull();
    expect(parsePoketraceTier("SGC_10")).toBeNull();
    expect(parsePoketraceTier("PSA")).toBeNull();
    expect(parsePoketraceRawTier("PSA_10")).toBeNull();
  });
});

describe("graded market summary", () => {
  it("keeps the highest graded sale and supported tiers when per-grade amounts are absent", () => {
    const summary = applyGradedMarketSummary(emptySlabEstimate("base1-58"), {
      topPrice: 88.76,
      gradedOptions: ["PSA_10", "PSA_9", "SGC_10", "NEAR_MINT"],
    });
    expect(summary.source).toBe("poketrace");
    expect(summary.topAmount).toBe("88.76");
    expect(summary.gradedTiers).toEqual([
      { company: "PSA", grade: "10" },
      { company: "PSA", grade: "9" },
    ]);
    expect(summary.rows.every((row) => row.amountCents === null)).toBe(true);
  });
});

describe("slab estimate DTO", () => {
  it("always shows Prepare raw rows and does not invent dollars", () => {
    const empty = emptySlabEstimate("base1-58");
    expect(empty.rawRows.map((row) => row.condition)).toEqual([...PREPARE_RAW_ROWS]);
    expect(empty.rows.map((row) => `${row.company} ${row.grade}`)).toEqual(
      PREPARE_SLAB_ROWS.map((row) => `${row.company} ${row.grade}`),
    );
    expect(empty.rawRows.every((row) => row.amountCents === null)).toBe(true);
    expect(empty.rows.every((row) => row.amountCents === null)).toBe(true);
    expect(empty.topAmountCents).toBeNull();
    expect(empty.gradedTiers).toEqual([]);
    expect(empty.notAMarket).toBe(true);
    expect(empty.notABid).toBe(true);
    expect(empty.disclaimer).toBe(SLAB_PRICE_DISCLAIMER);
    expect(empty.display).toBe(SLAB_PRICE_EMPTY_COPY);
  });

  it("fills Free-plan raw NM–DMG from eBay without graded comps", () => {
    const estimate = slabEstimatesFromPoketracePrices("base1-58", {
      tcgplayer: { NEAR_MINT: { avg: 1 } },
      ebay: {
        NEAR_MINT: { avg: 12.4, median7d: 11 },
        LIGHTLY_PLAYED: { avg: 8 },
        MODERATELY_PLAYED: { avg: 5 },
        HEAVILY_PLAYED: { avg: 3 },
        DAMAGED: { avg: 1.5 },
      },
    });
    expect(estimate.source).toBe("poketrace");
    expect(estimate.notABid).toBe(true);
    expect(hasPrepareGradedAmounts(estimate)).toBe(false);
    const byCondition = Object.fromEntries(
      estimate.rawRows.map((row) => [row.condition, row.amount]),
    );
    expect(byCondition).toEqual({
      NM: "11.00",
      LP: "8.00",
      MP: "5.00",
      HP: "3.00",
      DMG: "1.50",
    });
  });

  it("prefers eBay graded avgs and keeps Prepare slots for a later Pro plan", () => {
    const estimate = slabEstimatesFromPoketracePrices("base1-58", {
      tcgplayer: { PSA_10: { avg: 1 } },
      ebay: {
        PSA_10: { avg: 120.4, median7d: 118 },
        PSA_9: { avg: 55 },
        "BGS_9.5": { avg: 90 },
        CGC_10: { avg: 70 },
        TAG_10: { avg: 65 },
        NEAR_MINT: { avg: 12 },
      },
    });
    expect(estimate.source).toBe("poketrace");
    expect(estimate.notABid).toBe(true);
    expect(estimate.rawRows.find((row) => row.condition === "NM")?.amount).toBe("12.00");
    const byLabel = Object.fromEntries(
      estimate.rows.map((row) => [`${row.company} ${row.grade}`, row.amount]),
    );
    expect(byLabel["PSA 10"]).toBe("120.40");
    expect(byLabel["PSA 9"]).toBe("55.00");
    expect(byLabel["PSA 8"]).toBeNull();
    expect(byLabel["BGS 9.5"]).toBe("90.00");
    expect(byLabel["CGC 10"]).toBe("70.00");
    expect(byLabel["TAG 10"]).toBe("65.00");
  });

  it("reads rolling avgs when a paid plan omits median7d", () => {
    const estimate = slabEstimatesFromPoketracePrices("base1-58", {
      ebay: { PSA_8: { avg7d: 40.2 } },
    });
    expect(estimate.source).toBe("poketrace");
    expect(estimate.rows.find((row) => row.company === "PSA" && row.grade === "8")?.amount).toBe(
      "40.20",
    );
  });
});

describe("typical grading fees", () => {
  it("labels the static table as not live", () => {
    expect(typicalGradingFeeNote("PSA Regular")).toBe("Typical PSA Regular fee $50 — not live.");
    expect(typicalGradingFeeNote("cgc")).toBe("Typical CGC Standard fee $20 — not live.");
    expect(typicalGradingFeeNote(null)).toContain("not live");
  });
});
