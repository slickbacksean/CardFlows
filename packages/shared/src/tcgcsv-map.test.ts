import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computePriceDelta,
  pairPriceDeltas,
  selectMovers,
  TRENDING_MIN_PRICE_CENTS,
} from "./trending";
import {
  isEnglishTcgcsvGroupName,
  mapTcgcsvGroupToTcgdexSet,
  mapTcgcsvProductToTcgdex,
  marketUsdToCents,
  tcgcsvCollectorNumber,
  tcgcsvExternalId,
  tcgcsvFinishesFromPrices,
  tcgcsvLocalId,
  tcgcsvProductIsCard,
  tcgcsvSubtypeToVariant,
  type TcgcsvGroupRef,
  type TcgcsvPriceRef,
  type TcgcsvProductRef,
} from "./tcgcsv-map";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/tcgcsv");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as T;
}

interface Collection<T> {
  success?: boolean;
  results: T[];
}

function groupById(id: number): TcgcsvGroupRef {
  const groups = readJson<Collection<TcgcsvGroupRef>>("groups.json").results;
  const group = groups.find((row) => row.groupId === id);
  if (!group) throw new Error(`missing fixture group ${id}`);
  return group;
}

describe("TCGCSV English filter + subtypes", () => {
  it("keeps English groups and skips JP exclusives", () => {
    expect(isEnglishTcgcsvGroupName("Base Set")).toBe(true);
    expect(isEnglishTcgcsvGroupName("Ash vs Team Rocket Deck Kit (JP Exclusive)")).toBe(false);
    expect(isEnglishTcgcsvGroupName("Japanese")).toBe(false);
  });

  it("maps TCGCSV printings onto pokemontcg.io variant keys", () => {
    expect(tcgcsvSubtypeToVariant("Normal")).toBe("normal");
    expect(tcgcsvSubtypeToVariant("Holofoil")).toBe("holofoil");
    expect(tcgcsvSubtypeToVariant("Reverse Holofoil")).toBe("reverseHolofoil");
    expect(tcgcsvSubtypeToVariant("1st Edition")).toBe("1stEdition");
    expect(tcgcsvSubtypeToVariant("1st Edition Holofoil")).toBe("1stEditionHolofoil");
    expect(tcgcsvSubtypeToVariant("Unlimited")).toBe("unlimited");
    expect(tcgcsvSubtypeToVariant("Unlimited Holofoil")).toBe("unlimitedHolofoil");
    expect(tcgcsvSubtypeToVariant("Cosmos Holofoil")).toBe("cosmosHolofoil");
    expect(tcgcsvSubtypeToVariant("")).toBeNull();
  });

  it("rounds market USD to cents and drops nulls", () => {
    expect(marketUsdToCents(12.5)).toBe(1250);
    expect(marketUsdToCents(0)).toBe(0);
    expect(marketUsdToCents(null)).toBeNull();
    expect(marketUsdToCents(-1)).toBeNull();
  });
});

describe("TCGCSV collector numbers", () => {
  it("unpads WotC, pads SV/ME, keeps promo and TG prefixes", () => {
    expect(tcgcsvLocalId("base1", "001/102")).toBe("1");
    expect(tcgcsvLocalId("base1", "010/102")).toBe("10");
    expect(tcgcsvLocalId("swsh12", "138/195")).toBe("138");
    expect(tcgcsvLocalId("sv01", "013/198")).toBe("013");
    expect(tcgcsvLocalId("sv03.5", "170/165")).toBe("170");
    expect(tcgcsvLocalId("me01", "1")).toBe("001");
    expect(tcgcsvLocalId("swshp", "SWSH001")).toBe("SWSH001");
    expect(tcgcsvLocalId("swsh12tg", "TG17/TG30")).toBe("TG17");
    expect(tcgcsvLocalId("svp", "SVP001")).toBe("001");
  });
});

describe("TCGCSV group → TCGdex set", () => {
  it("uses the curated group-name table", () => {
    expect(mapTcgcsvGroupToTcgdexSet(groupById(604))).toMatchObject({ tcgdexSetId: "base1", method: "group_name" });
    expect(mapTcgcsvGroupToTcgdexSet(groupById(22873))).toMatchObject({ tcgdexSetId: "sv01", method: "group_name" });
    expect(mapTcgcsvGroupToTcgdexSet(groupById(3170))).toMatchObject({ tcgdexSetId: "swsh12", method: "group_name" });
    expect(mapTcgcsvGroupToTcgdexSet(groupById(23237))).toMatchObject({ tcgdexSetId: "sv03.5", method: "group_name" });
    expect(mapTcgcsvGroupToTcgdexSet(groupById(2545))).toMatchObject({ tcgdexSetId: "swshp", method: "group_name" });
    expect(mapTcgcsvGroupToTcgdexSet(groupById(17674))).toMatchObject({ tcgdexSetId: "swsh12tg", method: "group_name" });
    expect(mapTcgcsvGroupToTcgdexSet(groupById(1663))).toMatchObject({ tcgdexSetId: "base1", method: "group_name" });
  });

  it("skips non-English and unknown groups instead of inventing a set id", () => {
    expect(mapTcgcsvGroupToTcgdexSet(groupById(23095))).toMatchObject({
      tcgdexSetId: null,
      unmatchedReason: "non_english",
    });
    expect(
      mapTcgcsvGroupToTcgdexSet({ groupId: 2374, name: "Miscellaneous Cards & Products", abbreviation: "MCAP" }),
    ).toMatchObject({ tcgdexSetId: null, method: "unmatched" });
  });

  it("maps a new numbered English set via era code when TCGdex already has the id", () => {
    expect(mapTcgcsvGroupToTcgdexSet({ groupId: 1, name: "ME06: Brand New Title", abbreviation: "DLR" })).toMatchObject({
      tcgdexSetId: "me06",
      method: "era_code",
    });
    expect(mapTcgcsvGroupToTcgdexSet({ groupId: 1, name: "ME99: Does Not Exist", abbreviation: "ZZZ" })).toMatchObject({
      tcgdexSetId: null,
    });
  });
});

describe("TCGCSV product → TCGdex (recorded fixtures)", () => {
  it("maps Base Set, SV, SWSH, promos, and trainer gallery; skips sealed", () => {
    const base = mapTcgcsvProductToTcgdex(
      readJson<Collection<TcgcsvProductRef>>("604-products.json").results[0]!,
      groupById(604),
    );
    expect(base).toMatchObject({
      externalId: tcgcsvExternalId(42346),
      tcgdexId: "base1-1",
      localId: "1",
      status: "matched",
    });

    const sv = mapTcgcsvProductToTcgdex(
      readJson<Collection<TcgcsvProductRef>>("22873-products.json").results[0]!,
      groupById(22873),
    );
    expect(sv).toMatchObject({ tcgdexId: "sv01-013", status: "matched" });

    const swsh = mapTcgcsvProductToTcgdex(
      readJson<Collection<TcgcsvProductRef>>("3170-products.json").results[0]!,
      groupById(3170),
    );
    expect(swsh).toMatchObject({ tcgdexId: "swsh12-138", status: "matched" });

    const promo = mapTcgcsvProductToTcgdex(
      readJson<Collection<TcgcsvProductRef>>("2545-products.json").results[0]!,
      groupById(2545),
    );
    expect(promo).toMatchObject({ tcgdexId: "swshp-SWSH001", status: "matched" });

    const tg = mapTcgcsvProductToTcgdex(
      readJson<Collection<TcgcsvProductRef>>("17674-products.json").results[0]!,
      groupById(17674),
    );
    expect(tg).toMatchObject({ tcgdexId: "swsh12tg-TG17", status: "matched" });

    const sealed = readJson<Collection<TcgcsvProductRef>>("3170-products.json").results.find(
      (row) => !tcgcsvProductIsCard(row),
    );
    expect(sealed?.name).toMatch(/Booster Pack/i);
    expect(mapTcgcsvProductToTcgdex(sealed!, groupById(3170))).toMatchObject({
      status: "unmatched",
      unmatchedReason: "not_a_card",
      tcgdexId: null,
    });
  });

  it("does not invent ids for JP groups or unnumbered products", () => {
    const jp = mapTcgcsvProductToTcgdex(
      { productId: 1, name: "Pikachu", extendedData: [{ name: "Number", value: "1" }] },
      groupById(23095),
    );
    expect(jp).toMatchObject({ status: "unmatched", unmatchedReason: "non_english", tcgdexId: null });
  });

  it("records a sample match rate on the recorded TCGCSV dumps", () => {
    const cases: Array<{ groupId: number; file: string }> = [
      { groupId: 604, file: "604-products.json" },
      { groupId: 3170, file: "3170-products.json" },
      { groupId: 22873, file: "22873-products.json" },
      { groupId: 23237, file: "23237-products.json" },
      { groupId: 2545, file: "2545-products.json" },
      { groupId: 17674, file: "17674-products.json" },
      { groupId: 1663, file: "1663-products.json" },
    ];
    let cards = 0;
    let matched = 0;
    let sealed = 0;
    for (const row of cases) {
      const group = groupById(row.groupId);
      for (const product of readJson<Collection<TcgcsvProductRef>>(row.file).results) {
        const mapped = mapTcgcsvProductToTcgdex(product, group);
        if (!tcgcsvCollectorNumber(product)) {
          sealed += 1;
          expect(mapped.status).toBe("unmatched");
          continue;
        }
        cards += 1;
        if (mapped.status === "matched") matched += 1;
      }
    }
    expect(cards).toBeGreaterThan(10);
    expect(matched / cards).toBe(1);
    expect(sealed).toBeGreaterThan(0);
  });
});

describe("TCGCSV finishes + movers", () => {
  it("joins recorded prices by productId and subtype", () => {
    const product = readJson<Collection<TcgcsvProductRef>>("604-products.json").results[0]!;
    const prices = readJson<Collection<TcgcsvPriceRef>>("604-prices.json").results;
    const finishes = tcgcsvFinishesFromPrices(prices, product.productId);
    expect(finishes).toEqual([{ variant: "holofoil", cents: 7607 }]);
  });

  it("keeps 1st Edition as its own variant so movers pair same-printing to same-printing", () => {
    const current = tcgcsvFinishesFromPrices(
      [
        { productId: 1, marketPrice: 12, subTypeName: "1st Edition Holofoil" },
        { productId: 1, marketPrice: 4, subTypeName: "Unlimited Holofoil" },
      ],
      1,
    );
    const previous = tcgcsvFinishesFromPrices(
      [
        { productId: 1, marketPrice: 8, subTypeName: "1st Edition Holofoil" },
        { productId: 1, marketPrice: 5, subTypeName: "Unlimited Holofoil" },
      ],
      1,
    );
    expect(current.map((row) => row.variant)).toEqual(["1stEditionHolofoil", "unlimitedHolofoil"]);
    const deltas = pairPriceDeltas(
      current.map((row) => ({ tcgdexId: "gym1-1", variant: row.variant, priceCents: row.cents })),
      previous.map((row) => ({ tcgdexId: "gym1-1", variant: row.variant, priceCents: row.cents })),
    );
    const up = selectMovers(deltas, { direction: "up", minPriceCents: TRENDING_MIN_PRICE_CENTS });
    expect(up).toHaveLength(1);
    expect(up[0]?.variant).toBe("1stEditionHolofoil");
    expect(up[0]?.changePercent).toBe(50);
    expect(
      computePriceDelta(
        { tcgdexId: "gym1-1", variant: "1stEditionHolofoil", priceCents: 1200 },
        { tcgdexId: "gym1-1", variant: "unlimitedHolofoil", priceCents: 500 },
      ),
    ).toBeNull();
  });
});
