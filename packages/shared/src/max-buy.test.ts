import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeMaxBuy,
  DEFAULT_MAX_BUY_PREFERENCES,
  MAX_BUY_FEES_BUFFER_INVALID_MESSAGE,
  MAX_BUY_MARGIN_INVALID_MESSAGE,
  maxBuyPreferencesRangeError,
  maxBuyPreferencesToFormValues,
  parseMaxBuyRulesForm,
} from "./max-buy";
import { dollarsToCents } from "./money";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("computeMaxBuy", () => {
  it("uses round-half-up cents: 8.00 × 0.80 × 0.87 = 5.57", () => {
    const result = computeMaxBuy({ referencePriceAmount: 8, condition: "NM" });
    expect(result.maxBuyAmountCents).toBe(557);
    expect(result.maxBuyAmount).toBe("5.57");
    expect(result.referencePriceSource).toBe("user_entered");
    expect(result.currency).toBe("USD");
  });

  it("applies an optional condition map", () => {
    const result = computeMaxBuy({
      referencePriceAmount: "8.00",
      condition: "LP",
      preferences: {
        conditionAdjustments: { NM: 1, LP: 0.85 },
      },
    });
    expect(result.currentConditionFactor).toBe(0.85);
    expect(result.maxBuyAmountCents).toBe(dollarsToCents(8 * 0.8 * 0.87 * 0.85));
  });

  it("defaults condition_factor to 1.0 when the map is missing", () => {
    const result = computeMaxBuy({
      referencePriceAmount: "8.00",
      condition: "HP",
    });
    expect(result.currentConditionFactor).toBe(1);
    expect(result.maxBuyAmount).toBe("5.57");
  });

  it("still returns guidance metadata when reference is null", () => {
    const result = computeMaxBuy({ referencePriceAmount: null });
    expect(result.maxBuyAmount).toBeNull();
    expect(result.display).toContain("Enter a reference price");
  });
});

describe("Max Buy rules form", () => {
  it("seeds the default 20 / 13 / USD / 1.0 fields", () => {
    expect(maxBuyPreferencesToFormValues(DEFAULT_MAX_BUY_PREFERENCES)).toEqual({
      targetMarginDisplay: "20",
      feesBufferDisplay: "13",
      conditionFactorNmDisplay: "1.0",
      currency: "USD",
    });
  });

  it("rejects a margin outside 0–99 with the wireframe copy", () => {
    const result = parseMaxBuyRulesForm({
      targetMarginDisplay: "200",
      feesBufferDisplay: "13",
      conditionFactorNmDisplay: "1.0",
    });
    expect(result).toEqual({
      ok: false,
      error: MAX_BUY_MARGIN_INVALID_MESSAGE,
    });
    expect(MAX_BUY_MARGIN_INVALID_MESSAGE).toBe("Margin must be between 0 and 99.");
  });

  it("rejects a fees buffer outside 0–99 with the shared copy", () => {
    const result = parseMaxBuyRulesForm({
      targetMarginDisplay: "20",
      feesBufferDisplay: "200",
      conditionFactorNmDisplay: "1.0",
    });
    expect(result).toEqual({
      ok: false,
      error: MAX_BUY_FEES_BUFFER_INVALID_MESSAGE,
    });
  });

  it("does not build preferences that could be PATCHed when margin is 200", () => {
    const result = parseMaxBuyRulesForm({
      targetMarginDisplay: "200",
      feesBufferDisplay: "13",
      conditionFactorNmDisplay: "1.0",
    });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("preferences");
  });

  it("rejects a negative factor and a non-numeric factor", () => {
    expect(
      maxBuyPreferencesRangeError({
        targetMarginPct: 0.2,
        feesBufferPct: 0.13,
        conditionAdjustments: { NM: -5, LP: "x" },
      }),
    ).toBe("Condition factor must be 0 or greater.");
  });

  it("rejects stored percents above 0.99 before PATCH", () => {
    expect(
      maxBuyPreferencesRangeError({
        targetMarginPct: 2,
        feesBufferPct: 0.13,
      }),
    ).toBe(MAX_BUY_MARGIN_INVALID_MESSAGE);
    expect(
      maxBuyPreferencesRangeError({
        targetMarginPct: 0.2,
        feesBufferPct: 2,
      }),
    ).toBe(MAX_BUY_FEES_BUFFER_INVALID_MESSAGE);
    expect(maxBuyPreferencesRangeError(DEFAULT_MAX_BUY_PREFERENCES)).toBeNull();
  });

  it("treats an empty NM factor as 1.0", () => {
    const result = parseMaxBuyRulesForm({
      targetMarginDisplay: "20",
      feesBufferDisplay: "13",
      conditionFactorNmDisplay: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preferences).toEqual(DEFAULT_MAX_BUY_PREFERENCES);
    }
  });

  it("accepts 0 and 99 percent", () => {
    const zero = parseMaxBuyRulesForm({
      targetMarginDisplay: "0",
      feesBufferDisplay: "99",
      conditionFactorNmDisplay: "1.0",
    });
    expect(zero.ok).toBe(true);
    if (zero.ok) {
      expect(zero.preferences.targetMarginPct).toBe(0);
      expect(zero.preferences.feesBufferPct).toBe(0.99);
    }
  });
});

describe("Invalid Max Buy save does not persist", () => {
  it("shows the wireframe copy and returns before PATCH", () => {
    const screen = readRepoFile("apps/mobile/app/max-buy-rules.tsx");
    expect(screen).toContain("parseMaxBuyRulesForm");
    expect(screen).toContain("MAX_BUY_MARGIN_INVALID_MESSAGE");
    expect(screen).toContain("MAX_BUY_FEES_BUFFER_INVALID_MESSAGE");
    expect(screen).toMatch(/if \(!parsed\.ok\) \{[\s\S]*?return;/);
    expect(screen.indexOf("if (!parsed.ok)")).toBeLessThan(
      screen.indexOf("saveMaxBuyPreferences(parsed.preferences)"),
    );
  });

  it("blocks out-of-range PATCH on the client and API before storing", () => {
    const preferences = readRepoFile("apps/mobile/lib/preferences.ts");
    expect(preferences).toContain("maxBuyPreferencesRangeError");
    expect(preferences.indexOf("maxBuyPreferencesRangeError(preferences)")).toBeLessThan(
      preferences.indexOf("patchPreferences(withLockedDisplayCurrency(preferences))"),
    );

    const api = readRepoFile("apps/api/src/app.ts");
    expect(api).toContain("maxBuyPreferencesRangeError");
    expect(api.indexOf("maxBuyPreferencesRangeError(next)")).toBeLessThan(
      api.indexOf("setPreferences(userId, next)"),
    );
  });
});
