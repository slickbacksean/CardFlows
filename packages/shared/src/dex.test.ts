import { describe, expect, it } from "vitest";
import { buildDexSet, dexOwnedCountsBySet, dexProgressLabel, dexSetIdOf, dexThumbUrl, dexTileTone } from "./dex";

describe("dex", () => {
  it("builds a sorted set with owned flags and a count", () => {
    const view = buildDexSet(
      { setId: "sv1", name: "Scarlet & Violet" },
      [
        { id: "sv1-10", localId: "10", name: "B", image: "https://assets.tcgdex.net/en/sv/sv1/10" },
        { id: "sv1-2", localId: "2", name: "A", image: null },
      ],
      new Set(["sv1-10"]),
    );
    expect(view.cards.map((c) => c.localId)).toEqual(["2", "10"]);
    expect(view.cards[1]).toMatchObject({ owned: true, thumbUrl: "https://assets.tcgdex.net/en/sv/sv1/10/low.webp" });
    expect(view.cards[0]?.thumbUrl).toBeNull();
    expect(dexProgressLabel(view.owned, view.total)).toBe("1/2");
  });

  it("helpers", () => {
    expect(dexSetIdOf("swsh12pt5-001")).toBe("swsh12pt5");
    expect(dexSetIdOf("sv03.5-12")).toBe("sv03.5");
    expect(dexThumbUrl("x/")).toBe("x/low.webp");
    expect(dexOwnedCountsBySet(["a-1", "a-2", "b-1"]).get("a")).toBe(2);
    expect(dexTileTone(false)).toEqual({ opacity: 0.35, grayscale: true });
    expect(dexTileTone(true).opacity).toBe(1);
  });
});
