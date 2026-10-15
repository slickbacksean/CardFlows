import { describe, expect, it } from "vitest";
import {
  confirmCountsFrom,
  confirmEventFor,
  isConfirmCorrection,
  replayTop1,
  rerankByConfirms,
  suggestVariants,
  type ConfirmEvent,
} from "./confirm-log";

const ev = (shown: string[], chosen: string, i: number): ConfirmEvent =>
  confirmEventFor({ scanId: `s${i}`, userId: "u", shownTcgdexIds: shown, chosenTcgdexId: chosen, now: new Date(Date.UTC(2026, 9, 1, 0, i)) });

describe("confirm log", () => {
  it("records rank and via", () => {
    expect(ev(["a", "b"], "a", 0)).toMatchObject({ chosenRank: 1, via: "recognition" });
    expect(ev(["a", "b"], "b", 0)).toMatchObject({ chosenRank: 2, via: "candidate" });
    const manual = confirmEventFor({ scanId: "s", userId: "u", via: "manual_search", shownTcgdexIds: ["a"], chosenTcgdexId: "z" });
    expect(manual).toMatchObject({ chosenRank: null, via: "manual_search" });
    expect(isConfirmCorrection(manual)).toBe(true);
  });

  it("stores metadata only", () => {
    expect(Object.keys(ev(["a"], "a", 0)).sort()).toEqual(
      ["at", "chosenRank", "chosenTcgdexId", "confidence", "recognitionProvider", "scanId", "selectedVariant", "shownTcgdexIds", "userId", "via"],
    );
  });

  it("keeps recognition order with no or thin history", () => {
    expect(rerankByConfirms(["a", "b", "c"], new Map())).toEqual(["a", "b", "c"]);
    expect(rerankByConfirms(["a", "b"], new Map([["b", 1]]))).toEqual(["a", "b"]);
  });

  it("promotes a card users keep confirming", () => {
    expect(rerankByConfirms(["a", "b", "c"], new Map([["b", 3]]))).toEqual(["b", "a", "c"]);
  });

  it("improves top-1 on a replayed log of a repeat same-art mix-up", () => {
    const log = Array.from({ length: 10 }, (_, i) => ev(["base4-51", "base1-36"], "base1-36", i));
    const r = replayTop1(log);
    expect(r.baselineTop1).toBe(0);
    expect(r.rerankedTop1).toBeGreaterThan(r.baselineTop1);
    expect(confirmCountsFrom(log).get("base1-36")).toBe(10);
  });

  it("suggests only real variants, most-picked first", () => {
    const variants = { holo: true, reverse: true, normal: false, firstEdition: true, wPromo: false };
    expect(suggestVariants({ variants }).map((v) => v.variant)).toEqual(["holo", "reverse", "firstEdition"]);
    expect(suggestVariants({ variants, pickedVariantCounts: new Map([["reverse", 4]]) })[0]?.variant).toBe("reverse");
    expect(suggestVariants({ variants: { ...variants, reverse: false, firstEdition: false } })).toEqual([]);
  });
});
