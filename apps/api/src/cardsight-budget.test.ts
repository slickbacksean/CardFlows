import { describe, expect, it } from "vitest";
import {
  canCardMagicUseBudget,
  consumeCardSightBudget,
  shouldAlertCardSightUsage,
} from "./cardsight-budget";
import { cardMagicIdReserveFromEnv, cardSightMonthlyBudgetFromEnv } from "./grade-quota-env";
import { createMemoryStore } from "./store";

describe("CardSight free-plan budget + CardMagic ID reserve", () => {
  it("defaults the monthly cap to 750 outside tests (CardSight free plan)", () => {
    expect(cardSightMonthlyBudgetFromEnv({})).toBe(750);
    expect(cardSightMonthlyBudgetFromEnv({ VITEST: "true" })).toBeNull();
    expect(cardSightMonthlyBudgetFromEnv({ VITEST: "true", CARD_FLOW_CARDSIGHT_MONTHLY_BUDGET: "750" })).toBe(750);
  });

  it("defaults the ID reserve to 600 when the cap is 750, else ~80% of the cap", () => {
    expect(cardMagicIdReserveFromEnv({}, 750)).toBe(600);
    expect(cardMagicIdReserveFromEnv({}, 1000)).toBe(800);
    expect(cardMagicIdReserveFromEnv({ CARD_FLOW_CARDMAGIC_ID_RESERVE: "500" }, 750)).toBe(500);
    expect(cardMagicIdReserveFromEnv({ CARD_FLOW_CARDMAGIC_ID_RESERVE: "9999" }, 750)).toBe(750);
    expect(cardMagicIdReserveFromEnv({}, null)).toBe(0);
  });

  it("allows CardMagic only while used is below cap minus reserve", () => {
    // Free plan: cap 750, reserve 600 → CardMagic room while used < 150
    expect(canCardMagicUseBudget(0, 750, 600)).toBe(true);
    expect(canCardMagicUseBudget(149, 750, 600)).toBe(true);
    expect(canCardMagicUseBudget(150, 750, 600)).toBe(false);
    expect(canCardMagicUseBudget(700, 750, 600)).toBe(false);
    expect(canCardMagicUseBudget(0, 100, 80)).toBe(true);
    expect(canCardMagicUseBudget(20, 100, 80)).toBe(false);
  });

  it("alerts at about 80% of the cap", () => {
    expect(shouldAlertCardSightUsage(599, 750)).toBe(false);
    expect(shouldAlertCardSightUsage(600, 750)).toBe(true);
    expect(shouldAlertCardSightUsage(750, 750)).toBe(true);
    expect(shouldAlertCardSightUsage(80, 100)).toBe(true);
    expect(shouldAlertCardSightUsage(79, 100)).toBe(false);
  });

  it("reports usage after a successful consume for the alert path", () => {
    const store = createMemoryStore();
    const seen: Array<{ used: number; cap: number }> = [];
    const now = new Date("2026-10-18T12:00:00.000Z");
    expect(
      consumeCardSightBudget({
        consume: store.consumeVendorQuota,
        getUsage: store.getVendorQuotaUsage,
        cap: 10,
        now,
        onUsage: (used, cap) => seen.push({ used, cap }),
      }),
    ).toBe(true);
    expect(seen).toEqual([{ used: 1, cap: 10 }]);
    expect(store.getVendorQuotaUsage("cardsight", "2026-10")).toBe(1);
  });
});
