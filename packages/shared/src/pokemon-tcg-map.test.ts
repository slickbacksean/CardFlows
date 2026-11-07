import { describe, expect, it } from "vitest";
import {
  localIdCandidates,
  mapPokemontcgCardToTcgdex,
  parsePokemontcgCardId,
  pokemontcgSetIdToTcgdex,
  preferredLocalId,
} from "./pokemon-tcg-map";

describe("pokemontcg.io → TCGdex ids", () => {
  it("parses set and number from the pokemontcg.io id", () => {
    expect(parsePokemontcgCardId("base1-4")).toEqual({ setId: "base1", number: "4" });
    expect(parsePokemontcgCardId("sv3pt5-1")).toEqual({ setId: "sv3pt5", number: "1" });
    expect(parsePokemontcgCardId("nope")).toBeNull();
    expect(parsePokemontcgCardId("-4")).toBeNull();
  });

  it("aliases half-sets and zero-pads Scarlet & Violet set ids", () => {
    expect(pokemontcgSetIdToTcgdex("sv1")).toBe("sv01");
    expect(pokemontcgSetIdToTcgdex("sv3pt5")).toBe("sv03.5");
    expect(pokemontcgSetIdToTcgdex("swsh12pt5")).toBe("swsh12.5");
    expect(pokemontcgSetIdToTcgdex("base1")).toBe("base1");
  });

  it("keeps WotC ids as-is", () => {
    expect(mapPokemontcgCardToTcgdex({ id: "base1-4", number: "4", setId: "base1", setName: "Base" })).toMatchObject({
      tcgdexId: "base1-4",
      status: "matched",
      method: "exact_id",
    });
  });

  it("maps Scarlet & Violet cards onto TCGdex padded ids", () => {
    const mapped = mapPokemontcgCardToTcgdex({
      id: "sv1-1",
      number: "1",
      setId: "sv1",
      setName: "Scarlet & Violet",
    });
    expect(mapped).toMatchObject({
      tcgdexId: "sv01-001",
      tcgdexSetId: "sv01",
      localId: "001",
      status: "matched",
      method: "padded_local_id",
    });
  });

  it("maps 151 (sv3pt5) onto sv03.5", () => {
    expect(
      mapPokemontcgCardToTcgdex({
        id: "sv3pt5-150",
        number: "150",
        setId: "sv3pt5",
        setName: "151",
      }),
    ).toMatchObject({
      tcgdexId: "sv03.5-150",
      tcgdexSetId: "sv03.5",
      status: "matched",
    });
  });

  it("marks unparseable ids unmatched and records the reason", () => {
    expect(mapPokemontcgCardToTcgdex({ id: "broken" })).toMatchObject({
      status: "unmatched",
      method: "unmatched",
      unmatchedReason: "id_unparseable",
      tcgdexId: null,
    });
  });

  it("marks unknown set prefixes unmatched when the set name is not in the alias table", () => {
    expect(
      mapPokemontcgCardToTcgdex({
        id: "zz99-1",
        number: "1",
        setId: "zz99",
        setName: "Not A Real Set",
      }),
    ).toMatchObject({
      status: "unmatched",
      unmatchedReason: "unknown_set:zz99",
      tcgdexId: null,
    });
  });

  it("pads numeric local ids for SV and lists candidates", () => {
    expect(preferredLocalId("sv01", "1")).toBe("001");
    expect(preferredLocalId("base1", "4")).toBe("4");
    expect(localIdCandidates("1")).toEqual(["1", "001"]);
  });
});
