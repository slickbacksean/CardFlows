import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  MVP_TCGDEX_LANGUAGE,
  mockTcgdexCatalogProvider,
  stripCatalogPricing,
  tcgdexCardFromWire,
} from "./catalog";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

function readSrc(name: string): string {
  return readFileSync(path.join(srcDir, name), "utf8");
}

describe("MockTcgdexCatalogProvider", () => {
  const catalog = mockTcgdexCatalogProvider;

  it("is named mock, English-only, and never calls the network", async () => {
    expect(catalog.name).toBe("mock");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("catalog mock must not call the network");
    });
    try {
      expect(await catalog.getCardById("base1-58", "fr")).toBeNull();
      expect(await catalog.getCardBySetAndLocalId("base1", "58", "ja")).toBeNull();
      expect(await catalog.resolveSetByName("Base Set", "de")).toEqual([]);
      expect(await catalog.listCards({ language: "fr", name: "Pikachu" })).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }

    expect(readSrc("catalog.ts")).toContain("tcgdex-card-example.json");
    expect(readSrc("catalog.ts")).toContain("cardflow-canonical-card-example.json");
    expect(readSrc("catalog.ts")).not.toMatch(/api\.tcgdex\.net|@tcgdex\/sdk/);
    expect(readSrc("mapper.ts")).not.toMatch(/api\.tcgdex\.net|@tcgdex\/sdk/);
  });

  it("wraps fixtures and MOCK_CARDS for getCardById / set+localId", async () => {
    const pikachu = await catalog.getCardById("base1-58", MVP_TCGDEX_LANGUAGE);
    expect(pikachu).toMatchObject({
      id: "base1-58",
      localId: "58",
      name: "Pikachu",
      language: "en",
      set: { id: "base1", name: "Base Set" },
    });
    expect(pikachu).not.toHaveProperty("pricing");
    expect(JSON.stringify(pikachu)).not.toContain('"pricing"');

    const bySet = await catalog.getCardBySetAndLocalId("base1", "58", "en");
    expect(bySet?.id).toBe("base1-58");

    const furret = await catalog.getCardById("swsh3-136", "en");
    expect(furret).toMatchObject({
      id: "swsh3-136",
      name: "Furret",
      localId: "136",
      illustrator: "tetsuya koizumi",
    });
    expect(furret).not.toHaveProperty("pricing");
  });

  it("resolves English set names and lists cards without inventing ids", async () => {
    const sets = await catalog.resolveSetByName("Base Set", "en");
    expect(sets).toEqual([
      expect.objectContaining({ id: "base1", name: "Base Set" }),
    ]);

    const listed = await catalog.listCards({
      language: "en",
      setName: "Base Set",
      localId: "58",
      name: "Pikachu",
    });
    expect(listed.map((card) => card.id)).toEqual(["base1-58"]);

    expect(await catalog.getCardById("not-a-real-id", "en")).toBeNull();
    expect(await catalog.getCardBySetAndLocalId("base1", "999", "en")).toBeNull();
    expect(await catalog.resolveSetByName("Unknown Promo Binder", "en")).toEqual([]);
    expect(
      await catalog.listCards({ language: "en", setName: "Unknown Promo Binder", localId: "999" }),
    ).toEqual([]);
  });

  it("strips pricing and variants_detailed pricing even on fixture-shaped records", () => {
    const poisoned = {
      id: "swsh3-136",
      name: "Furret",
      pricing: { holo: { market: 12.34 } },
      variants_detailed: {
        reverse: { pricing: { market: 9.99 }, available: true },
      },
      nested: [{ pricing: 1, keep: true }],
    };
    const stripped = stripCatalogPricing(poisoned);
    expect(stripped).toEqual({
      id: "swsh3-136",
      name: "Furret",
      variants_detailed: {
        reverse: { available: true },
      },
      nested: [{ keep: true }],
    });
    expect(stripped).not.toHaveProperty("pricing");
    expect(JSON.stringify(stripped)).not.toContain("pricing");
  });

  it("maps a live wire card onto the DTO without inventing ids or keeping pricing", () => {
    const card = tcgdexCardFromWire({
      id: "base1-58",
      localId: "58",
      name: "Pikachu",
      category: "Pokemon",
      image: "https://assets.tcgdex.net/en/base/base1/58",
      pricing: { market: 1 },
      set: { id: "base1", name: "Base Set", cardCount: { total: 102, official: 102 } },
      variants: { normal: true },
    });
    expect(card?.id).toBe("base1-58");
    expect(card).not.toHaveProperty("pricing");
    expect(tcgdexCardFromWire({ name: "Pikachu" })).toBeNull();
  });
});
