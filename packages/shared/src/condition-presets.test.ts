import { describe, expect, it } from "vitest";
import {
  conditionPresetsToForm,
  parseConditionPresetsForm,
  suggestedConditionPresetsForm,
} from "./condition-presets";
import { computeMaxBuy, DEFAULT_MAX_BUY_PREFERENCES, maxBuyPreferencesRangeError } from "./max-buy";
import { maxBuyBreakdown } from "./max-buy-breakdown";

describe("condition presets (P1-14)", () => {
  it("shows 100% everywhere until you set them, so nothing changes by default", () => {
    expect(conditionPresetsToForm(null)).toEqual({ NM: "100", LP: "100", MP: "100", HP: "100", DMG: "100" });
    expect(parseConditionPresetsForm(conditionPresetsToForm(null))).toEqual({ ok: true, conditionAdjustments: null });
    expect(DEFAULT_MAX_BUY_PREFERENCES.conditionAdjustments).toBeNull();
  });

  it("round-trips the suggested presets", () => {
    const form = suggestedConditionPresetsForm();
    expect(form).toEqual({ NM: "100", LP: "85", MP: "70", HP: "50", DMG: "30" });
    const parsed = parseConditionPresetsForm(form);
    expect(parsed).toEqual({ ok: true, conditionAdjustments: { NM: 1, LP: 0.85, MP: 0.7, HP: 0.5, DMG: 0.3 } });
  });

  it("rejects out-of-range or junk values", () => {
    for (const bad of ["-1", "101", "abc"]) {
      expect(parseConditionPresetsForm({ ...suggestedConditionPresetsForm(), LP: bad }).ok).toBe(false);
    }
    expect(parseConditionPresetsForm({ LP: "85%" })).toMatchObject({ ok: true });
  });

  it("keeps other stored keys and passes the API range check", () => {
    const parsed = parseConditionPresetsForm({ LP: "90" }, { Sealed: 1.1, LP: 0.5 });
    expect(parsed.ok && parsed.conditionAdjustments).toMatchObject({ Sealed: 1.1, LP: 0.9, NM: 1 });
    if (parsed.ok) {
      expect(maxBuyPreferencesRangeError({ ...DEFAULT_MAX_BUY_PREFERENCES, conditionAdjustments: parsed.conditionAdjustments })).toBeNull();
    }
  });

  it("a preset change moves Max Buy and shows on the breakdown's condition line", () => {
    const parsed = parseConditionPresetsForm({ LP: "80" });
    if (!parsed.ok) throw new Error("parse failed");
    const prefs = { ...DEFAULT_MAX_BUY_PREFERENCES, conditionAdjustments: parsed.conditionAdjustments };
    const lp = computeMaxBuy({ referencePriceAmount: "10.00", condition: "LP", preferences: prefs });
    const nm = computeMaxBuy({ referencePriceAmount: "10.00", condition: "NM", preferences: prefs });
    expect(nm.maxBuyAmount).toBe("6.96");
    expect(lp.maxBuyAmount).toBe("5.57");
    expect(maxBuyBreakdown(lp)!.lines[3]).toMatchObject({ label: "Condition (LP) × 0.8", amount: "-1.39" });
  });
});
