import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeMaxBuy, DEFAULT_MAX_BUY_PREFERENCES } from "./max-buy";
import {
  parseUserPriceAmount,
  priceSnapshotOptions,
  selectMaxBuyReference,
  userPriceLabel,
  type UserPriceSnapshot,
} from "./user-price";

const snap = (id: string, amount: string, enteredAt: string): UserPriceSnapshot => ({
  snapshotId: id, tcgdexId: "base1-58", variant: null, amount, currency: "USD", source: "you", enteredAt,
});

describe("your price snapshots (P1-12)", () => {
  it("labels as 'Your price · Oct 13'", () => {
    expect(userPriceLabel("2026-10-13T18:00:00.000Z", new Date("2026-10-14T12:00:00Z"))).toBe("Your price · Oct 13");
    expect(userPriceLabel("2025-10-13T18:00:00.000Z", new Date("2026-10-14T12:00:00Z"))).toBe("Your price · Oct 13, 2025");
  });

  it("parses typed amounts and rejects junk", () => {
    expect(parseUserPriceAmount("$8")).toBe("8.00");
    expect(parseUserPriceAmount("12,50")).toBe("12.50");
    for (const bad of ["", "0", "-3", "abc", "100001", null, {}]) expect(parseUserPriceAmount(bad)).toBeNull();
  });

  it("uses the newest snapshot unless you pick one", () => {
    const options = priceSnapshotOptions({
      userSnapshots: [snap("a", "8.00", "2026-10-13T10:00:00Z"), snap("b", "9.00", "2026-10-10T10:00:00Z")],
      vendor: { amount: "10.00", at: "2026-10-12T10:00:00Z", sourceLabel: "PokéCollector" },
    });
    expect(options.map((o) => o.key)).toEqual(["you:a", "vendor", "you:b"]);
    expect(selectMaxBuyReference(options)?.amount).toBe("8.00");
    expect(selectMaxBuyReference(options, "vendor")?.amount).toBe("10.00");
    expect(selectMaxBuyReference(options, "gone")?.amount).toBe("8.00");
  });

  it("computes Max Buy with pricing off from your price, with the default rule unchanged", () => {
    const options = priceSnapshotOptions({ userSnapshots: [snap("a", "8.00", "2026-10-13T10:00:00Z")], vendor: null });
    const ref = selectMaxBuyReference(options);
    const maxBuy = computeMaxBuy({ referencePriceAmount: ref?.amount ?? null, preferences: DEFAULT_MAX_BUY_PREFERENCES });
    expect(maxBuy.maxBuyAmount).not.toBeNull();
    expect(selectMaxBuyReference([])).toBeNull();
  });

  it("does not change the Max Buy defaults", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "user-price.ts"), "utf8");
    expect(src).not.toMatch(/targetMarginPct|feesBufferPct/);
  });
});
