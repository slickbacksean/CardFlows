import { describe, expect, it } from "vitest";
import {
  firstPricedPrinting,
  hasTcgplayerMarket,
  marketCentsForPrinting,
  tcgplayerMarketCents,
} from "./tcgplayer-market";

const CLOYSTER = {
  id: "gym1-29",
  name: "Misty's Cloyster",
  variants: { firstEdition: true, holo: false, normal: true, reverse: false },
  pricing: {
    tcgplayer: {
      unit: "USD",
      updated: "2026-10-03T22:54:37.218Z",
      "1st-edition": { marketPrice: 26.98 },
      unlimited: { marketPrice: 14.7 },
    },
  },
};

describe("TCGPlayer market prices", () => {
  it("maps Misty's Cloyster unlimited to normal and 1st edition separately", () => {
    const prices = tcgplayerMarketCents(CLOYSTER, CLOYSTER.variants);
    expect(prices).toEqual({
      normal: 1470,
      holo: null,
      reverse: null,
      firstEdition: 2698,
    });
    expect(marketCentsForPrinting(prices, "normal")).toBe(1470);
    expect(marketCentsForPrinting(prices, "first edition")).toBe(2698);
  });

  it("keeps unlimited holofoil off the 1st edition printing", () => {
    const card = {
      variants: { firstEdition: true, holo: true, normal: false, reverse: false },
      pricing: {
        tcgplayer: {
          "1st-edition-holofoil": { marketPrice: 393.49 },
          "unlimited-holofoil": { marketPrice: 122.94 },
        },
      },
    };
    const prices = tcgplayerMarketCents(card, card.variants);
    expect(marketCentsForPrinting(prices, "holo")).toBe(12294);
    expect(marketCentsForPrinting(prices, "first edition")).toBe(39349);
    expect(marketCentsForPrinting(prices, "normal")).toBeNull();
  });

  it("uses holofoil when a holo card is flagged only as normal", () => {
    const card = {
      variants: { firstEdition: false, holo: false, normal: true, reverse: false },
      pricing: { tcgplayer: { holofoil: { marketPrice: 26.38 } } },
    };
    const prices = tcgplayerMarketCents(card, card.variants);
    expect(marketCentsForPrinting(prices, "normal")).toBe(2638);
    expect(marketCentsForPrinting(prices, "holo")).toBe(2638);
  });

  it("does not reuse unlimited holofoil as 1st edition", () => {
    const card = {
      variants: { firstEdition: true, holo: true, normal: false, reverse: false },
      pricing: { tcgplayer: { holofoil: { marketPrice: 944.53 } } },
    };
    const prices = tcgplayerMarketCents(card, card.variants);
    expect(marketCentsForPrinting(prices, "holo")).toBe(94453);
    expect(marketCentsForPrinting(prices, "first edition")).toBeNull();
  });

  it("keeps reverse and normal prices apart", () => {
    const card = {
      variants: { firstEdition: false, holo: false, normal: true, reverse: true },
      pricing: {
        tcgplayer: {
          normal: { marketPrice: 0.03 },
          "reverse-holofoil": { marketPrice: 0.18 },
        },
      },
    };
    const prices = tcgplayerMarketCents(card, card.variants);
    expect(marketCentsForPrinting(prices, "normal")).toBe(3);
    expect(marketCentsForPrinting(prices, "reverse")).toBe(18);
  });

  it("skips an unpriced normal printing when holofoil is the market price", () => {
    const prices = {
      normal: null,
      holo: 3322,
      reverse: 2732,
      firstEdition: null,
    };
    expect(firstPricedPrinting(prices, ["normal", "holo", "reverse"])).toBe("holo");
    expect(firstPricedPrinting(prices, ["normal", "first edition"])).toBeNull();
    expect(
      firstPricedPrinting(
        { normal: 1470, holo: null, reverse: null, firstEdition: 2698 },
        ["normal", "first edition"],
      ),
    ).toBe("normal");
  });

  it("ignores missing, zero, and non-price buckets", () => {
    const prices = tcgplayerMarketCents({
      pricing: {
        tcgplayer: {
          unit: "USD",
          normal: { marketPrice: 0 },
          holofoil: { marketPrice: null },
        },
      },
    });
    expect(hasTcgplayerMarket(prices)).toBe(false);
    expect(tcgplayerMarketCents({ name: "No prices" })).toEqual({
      normal: null,
      holo: null,
      reverse: null,
      firstEdition: null,
    });
  });
});
