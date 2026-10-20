import { describe, expect, it } from "vitest";
import { cardDeepLink, parseCardDeepLink, shareCardMessage, shareFlipMessage } from "./share-links";

const BANNED = /refer|reward|invite|earn|free month|bonus|promo|code|guarantee|profit|\bAI\b|PSA|BGS|CGC/i;

describe("D12 sharing with no reward", () => {
  it("deep links round-trip and reject non-catalog IDs", () => {
    expect(cardDeepLink("base1-58")).toBe("cardflow://card/base1-58");
    expect(parseCardDeepLink("cardflow://card/base1-58")).toBe("base1-58");
    expect(parseCardDeepLink("/card/swsh12pt5-160?x=1")).toBe("swsh12pt5-160");
    expect(cardDeepLink("inv_123")).toBeNull();
    expect(cardDeepLink("../../etc")).toBeNull();
    expect(parseCardDeepLink("https://evil.example/card/base1-58")).toBeNull();
  });
  it("card and flip messages carry no referral code, reward or estimate claim", () => {
    const card = shareCardMessage({ name: "Pikachu", number: "58", setName: "Base Set", tcgdexId: "base1-58" });
    expect(card).toBe("Pikachu #58 · Base Set\nOpen in PokeSniper: cardflow://card/base1-58");
    const flip = shareFlipMessage({ name: "Pikachu", costCents: 1050, saleCents: 2500, realized: true, tcgdexId: "base1-58" })!;
    expect(flip).toBe("Pikachu: Bought $10.50 → sold $25.00\nOpen in PokeSniper: cardflow://card/base1-58");
    for (const text of [card, flip]) {
      expect(text).not.toMatch(BANNED);
      expect(text).not.toMatch(/[?&](ref|r|code|utm_)/);
    }
  });
  it("no flip share for estimates or a missing cost", () => {
    expect(shareFlipMessage({ name: "X", costCents: 100, saleCents: 200, realized: false })).toBeNull();
    expect(shareFlipMessage({ name: "X", costCents: null, saleCents: 200, realized: true })).toBeNull();
  });
});
