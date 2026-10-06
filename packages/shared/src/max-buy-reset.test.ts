import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BUY_PREFERENCES,
  MAX_BUY_RESET_NOT_SAVED_NOTICE,
  maxBuyPreferencesToFormValues,
  parseMaxBuyRulesForm,
} from "./max-buy";
import type { MaxBuyPreferences } from "./types";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const nextFn = source.indexOf("\n  function ", start + 1);
  const nextAsync = source.indexOf("\n  async function ", start + 1);
  const candidates = [nextFn, nextAsync].filter((index) => index > start);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

describe("Reset defaults fills the form and persists only on Save", () => {
  it("Reset fills 20% / 13% / USD / NM 1.0", () => {
    expect(maxBuyPreferencesToFormValues(DEFAULT_MAX_BUY_PREFERENCES)).toEqual({
      targetMarginDisplay: "20",
      feesBufferDisplay: "13",
      conditionFactorNmDisplay: "1.0",
      currency: "USD",
    });
  });

  it("Reset then Save payload is the brief defaults GET would return", () => {
    const custom: MaxBuyPreferences = {
      targetMarginPct: 0.3,
      feesBufferPct: 0.1,
      defaultCurrency: "USD",
      conditionAdjustments: { NM: 0.9, LP: 0.85 },
    };
    const resetForm = maxBuyPreferencesToFormValues(DEFAULT_MAX_BUY_PREFERENCES);
    const parsed = parseMaxBuyRulesForm({
      targetMarginDisplay: resetForm.targetMarginDisplay,
      feesBufferDisplay: resetForm.feesBufferDisplay,
      conditionFactorNmDisplay: resetForm.conditionFactorNmDisplay,
      existingAdjustments: DEFAULT_MAX_BUY_PREFERENCES.conditionAdjustments,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.preferences).toEqual({
      targetMarginPct: 0.2,
      feesBufferPct: 0.13,
      defaultCurrency: "USD",
      conditionAdjustments: null,
    });
    expect(parsed.preferences).toEqual(DEFAULT_MAX_BUY_PREFERENCES);
    expect(parsed.preferences).not.toEqual(custom);
  });

  it("does not keep leftover condition keys unless Reset cleared them", () => {
    const form = maxBuyPreferencesToFormValues(DEFAULT_MAX_BUY_PREFERENCES);
    const leftover = parseMaxBuyRulesForm({
      targetMarginDisplay: form.targetMarginDisplay,
      feesBufferDisplay: form.feesBufferDisplay,
      conditionFactorNmDisplay: form.conditionFactorNmDisplay,
      existingAdjustments: { NM: 1, LP: 0.85 },
    });
    expect(leftover.ok).toBe(true);
    if (!leftover.ok) return;
    expect(leftover.preferences.conditionAdjustments).toEqual({ NM: 1, LP: 0.85 });
    expect(leftover.preferences).not.toEqual(DEFAULT_MAX_BUY_PREFERENCES);
  });

  it("Reset defaults applies shared defaults without PATCH", () => {
    const screen = readRepoFile("apps/mobile/app/max-buy-rules.tsx");
    const reset = functionBody(screen, "onResetDefaults");
    const save = functionBody(screen, "onSave");

    expect(screen).toContain('label="Reset defaults"');
    expect(screen).toContain('label="Save rules"');
    expect(reset).toContain("applyPreferences(DEFAULT_MAX_BUY_PREFERENCES)");
    expect(reset).toContain("MAX_BUY_RESET_NOT_SAVED_NOTICE");
    expect(reset).not.toContain("saveMaxBuyPreferences");
    expect(reset).not.toContain("patchPreferences");
    expect(save).toContain("saveMaxBuyPreferences(parsed.preferences)");
    expect(MAX_BUY_RESET_NOT_SAVED_NOTICE).toBe(
      "Defaults filled. Tap Save rules to persist.",
    );
  });

  it("has no bid-placement or marketplace fee-schedule fields", () => {
    const screen = readRepoFile("apps/mobile/app/max-buy-rules.tsx");
    expect(screen).not.toMatch(/bid[- ]placement/i);
    expect(screen).not.toMatch(/auto-offer/i);
    expect(screen).not.toMatch(/fee schedule/i);
    expect(screen).not.toMatch(/marketplace fee/i);
  });
});
