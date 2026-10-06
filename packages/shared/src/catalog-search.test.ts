import { describe, expect, it, vi } from "vitest";
import { CATALOG_NAME_ONLY_NOTICE } from "./catalog-flags";
import {
  createDisabledTcgdexCatalogProvider,
  canonicalCardFromTcgdex,
  mockTcgdexCatalogProvider,
} from "./catalog";
import { CatalogSearchRequestError, searchCatalog } from "./catalog-search";

describe("searchCatalog", () => {
  it("finds base1-58 by English set + number without auto-confirm or minting", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("catalog search tests must not call the network");
    });
    try {
      const byName = await searchCatalog(mockTcgdexCatalogProvider, {
        set: "Base Set",
        number: "58",
      });
      expect(byName.autoConfirm).toBe(false);
      expect(byName.userConfirmationRequired).toBe(true);
      expect(byName.nameOnly).toBe(false);
      expect(byName.cards).toHaveLength(1);
      expect(byName.cards[0]).toMatchObject({
        tcgdexId: "base1-58",
        localId: "58",
        name: "Pikachu",
        cardflowCardId: null,
      });
      expect(JSON.stringify(byName)).not.toContain("pricing");

      const bySetId = await searchCatalog(mockTcgdexCatalogProvider, {
        set: "base1",
        number: "58",
      });
      expect(bySetId.cards.map((card) => card.tcgdexId)).toEqual(["base1-58"]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("lets name-only populate a picker list without marking a match", async () => {
    const result = await searchCatalog(mockTcgdexCatalogProvider, { name: "Charizard" });
    expect(result.nameOnly).toBe(true);
    expect(result.autoConfirm).toBe(false);
    expect(result.notice).toBe(CATALOG_NAME_ONLY_NOTICE);
    expect(result.cards.map((card) => card.tcgdexId).sort()).toEqual([
      "base1-4",
      "base4-4",
      "lc-3",
    ]);
    expect(result.cards.every((card) => card.cardflowCardId === null)).toBe(true);
  });

  it("rejects empty and non-English queries", async () => {
    await expect(searchCatalog(mockTcgdexCatalogProvider, {})).rejects.toBeInstanceOf(
      CatalogSearchRequestError,
    );
    await expect(
      searchCatalog(mockTcgdexCatalogProvider, { set: "Base Set", number: "58", language: "fr" }),
    ).rejects.toMatchObject({ message: /English/ });
  });

  it("serves last-good cached catalog when the provider is down", async () => {
    const cached = canonicalCardFromTcgdex(
      (await mockTcgdexCatalogProvider.getCardById("base1-58", "en"))!,
      { cardflowCardId: "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58" },
    );
    const result = await searchCatalog(
      createDisabledTcgdexCatalogProvider(),
      { set: "Base Set", number: "58" },
      { cachedCards: [cached] },
    );
    expect(result.cached).toBe(true);
    expect(result.autoConfirm).toBe(false);
    expect(result.cards[0]?.tcgdexId).toBe("base1-58");
    expect(result.cards[0]?.cardflowCardId).toBeNull();
    expect(result.error?.code).toBe("FEATURE_DISABLED");
    expect(result.notice?.toLowerCase()).toContain("cached");
  });
});
