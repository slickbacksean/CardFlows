import { describe, expect, it } from "vitest";
import {
  LIVESTREAM_TCGPLAYER_LINK_COPY,
  createLivestreamPriceCache,
  livestreamPriceSnapshotEnabled,
  tcgplayerPokemonSearchUrl,
} from "./livestream-price-lookup";

describe("livestream price lookup", () => {
  it("keeps the bulk snapshot flag off by default", () => {
    expect(livestreamPriceSnapshotEnabled({})).toBe(false);
    expect(livestreamPriceSnapshotEnabled({ CARD_FLOW_LIVESTREAM_PRICE_SNAPSHOT: "0" })).toBe(false);
    expect(livestreamPriceSnapshotEnabled({ CARD_FLOW_LIVESTREAM_PRICE_SNAPSHOT: "1" })).toBe(true);
    expect(
      livestreamPriceSnapshotEnabled({ EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_PRICE_SNAPSHOT: "true" }),
    ).toBe(true);
  });

  it("builds a public TCGplayer search URL", () => {
    expect(tcgplayerPokemonSearchUrl({ name: "Pikachu", number: "58", setName: "Base" })).toBe(
      "https://www.tcgplayer.com/search/pokemon/product?q=Pikachu%2058%20Base&view=grid&ProductTypeName=Cards",
    );
    expect(LIVESTREAM_TCGPLAYER_LINK_COPY).toBe("See prices on TCGplayer");
  });

  it("expires on-demand cache entries after the TTL", () => {
    const cache = createLivestreamPriceCache<string>(1_000);
    cache.set("base1-58", "8.25", 0);
    expect(cache.get("base1-58", 500)).toBe("8.25");
    expect(cache.get("base1-58", 1_001)).toBeNull();
  });
});
