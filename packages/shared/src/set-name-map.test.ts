import { describe, expect, it } from "vitest";
import {
  mergeIntoSnapshot,
  emptyCatalogSnapshot,
  parseCatalogSnapshot,
  searchCatalogSnapshot,
  snapshotIsStale,
  CATALOG_SNAPSHOT_REFRESH_MS,
} from "./catalog-snapshot";
import {
  normalizeSetName,
  reportUnmappedSetName,
  setUnmappedSetNameReporter,
  tcgdexSetIdForName,
  type UnmappedSetNameReport,
} from "./set-name-map";
import type { CardFlowCanonicalCard } from "./types";

describe("set-name → TCGdex set ID (P1-04)", () => {
  it.each([
    ["Base Set", "base1"],
    ["Pokémon 151", "sv03.5"],
    ["Scarlet & Violet—151", "sv03.5"],
    ["Champions Path", "swsh3.5"],
    ["Sword and Shield", "swsh1"],
    ["SV Black Star Promos", "svp"],
    ["sv08.5", "sv08.5"],
    ["Pokemon GO", "swsh10.5"],
  ])("%s → %s", (name, id) => {
    expect(tcgdexSetIdForName(name)).toBe(id);
  });

  it("returns null for unknown sets and reports through the hook", () => {
    expect(tcgdexSetIdForName("Totally New Set")).toBeNull();
    const seen: UnmappedSetNameReport[] = [];
    setUnmappedSetNameReporter((r) => seen.push(r));
    reportUnmappedSetName({ setName: "Totally New Set", source: "cardsight", catalogSetId: null });
    setUnmappedSetNameReporter(null);
    expect(seen).toHaveLength(1);
  });

  it("normalizes punctuation, accents and the Pokémon prefix", () => {
    expect(normalizeSetName("Pokémon TCG: Champion’s Path")).toBe("champions path");
  });
});

function card(id: string, setId: string, setName: string, localId: string, name: string) {
  return {
    tcgdexId: id,
    tcgdexSetId: setId,
    localId,
    name,
    set: { id: setId, name: setName },
    image: { constructedUrl: `https://assets.tcgdex.net/en/x/${id}/high.webp` },
  } as unknown as CardFlowCanonicalCard;
}

describe("catalog snapshot offline search (P1-04)", () => {
  const snap = mergeIntoSnapshot(emptyCatalogSnapshot(), [
    card("base1-4", "base1", "Base Set", "4", "Charizard"),
    card("sv03.5-6", "sv03.5", "151", "006", "Charizard ex"),
  ]);

  it("finds cards by set name alias + number offline", () => {
    expect(searchCatalogSnapshot(snap, { set: "Pokemon 151", number: "6" }).map((c) => c.tcgdexId)).toEqual([
      "sv03.5-6",
    ]);
    expect(searchCatalogSnapshot(snap, { set: "base1", number: "4/102" })).toHaveLength(1);
    expect(searchCatalogSnapshot(snap, { name: "charizard" })).toHaveLength(2);
    expect(searchCatalogSnapshot(snap, {})).toEqual([]);
  });

  it("round-trips through JSON and refreshes weekly", () => {
    expect(parseCatalogSnapshot(JSON.stringify(snap))?.cards).toHaveLength(2);
    expect(parseCatalogSnapshot("{bad")).toBeNull();
    expect(snapshotIsStale(snap, Date.parse(snap.updatedAt) + CATALOG_SNAPSHOT_REFRESH_MS + 1)).toBe(true);
  });
});
