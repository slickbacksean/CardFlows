import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeMaxBuy,
  DEFAULT_MAX_BUY_PREFERENCES,
  LOCKED_DISPLAY_CURRENCY,
  maxBuyPreferencesToFormValues,
  parseMaxBuyRulesForm,
  withLockedDisplayCurrency,
} from "./max-buy";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function patchPreferencesHandler(source: string): string {
  const start = source.indexOf('app.patch("/v1/preferences"');
  expect(start).toBeGreaterThan(-1);
  const nextRoute = source.indexOf("\n  app.", start + 1);
  return nextRoute === -1 ? source.slice(start) : source.slice(start, nextRoute);
}

describe("Currency locked to USD", () => {
  it("is a shared USD constant, not a switcher list", () => {
    expect(LOCKED_DISPLAY_CURRENCY).toBe("USD");
    expect(DEFAULT_MAX_BUY_PREFERENCES.defaultCurrency).toBe(LOCKED_DISPLAY_CURRENCY);
  });

  it("ignores a client-requested currency on preferences", () => {
    expect(
      withLockedDisplayCurrency({
        ...DEFAULT_MAX_BUY_PREFERENCES,
        defaultCurrency: "EUR",
      }).defaultCurrency,
    ).toBe(LOCKED_DISPLAY_CURRENCY);
  });

  it("keeps Max Buy form currency USD even if stored prefs claim EUR", () => {
    expect(
      maxBuyPreferencesToFormValues({
        ...DEFAULT_MAX_BUY_PREFERENCES,
        defaultCurrency: "EUR",
      }).currency,
    ).toBe(LOCKED_DISPLAY_CURRENCY);
  });

  it("Save payload currency is USD", () => {
    const parsed = parseMaxBuyRulesForm({
      targetMarginDisplay: "20",
      feesBufferDisplay: "13",
      conditionFactorNmDisplay: "1.0",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.preferences.defaultCurrency).toBe(LOCKED_DISPLAY_CURRENCY);
    }
  });

  it("guidance currency stays USD even if prefs request EUR", () => {
    const result = computeMaxBuy({
      referencePriceAmount: 8,
      preferences: { defaultCurrency: "EUR" },
    });
    expect(result.currency).toBe(LOCKED_DISPLAY_CURRENCY);
  });

  it("PATCH ignores client defaultCurrency and keeps USD", () => {
    const api = readRepoFile("apps/api/src/app.ts");
    const patch = patchPreferencesHandler(api);
    expect(patch).toContain("LOCKED_DISPLAY_CURRENCY");
    expect(patch).not.toContain("body.defaultCurrency");
    expect(api).toContain('app.get("/v1/preferences"');
  });

  it("store GET/PATCH cache cannot keep a non-USD currency", () => {
    const helper = readRepoFile("packages/shared/src/user-preferences.ts");
    const store = readRepoFile("apps/api/src/store.ts");
    const clone = helper.slice(
      helper.indexOf("function clonePreferences"),
      helper.indexOf("export function createUserPreferencesStore"),
    );
    expect(clone).toContain("LOCKED_DISPLAY_CURRENCY");
    expect(clone).not.toContain("preferences.defaultCurrency");
    expect(store).toContain("createUserPreferencesStore()");
  });

  it("Max Buy Currency row is display text, not a picker", () => {
    const screen = readRepoFile("apps/mobile/app/max-buy-rules.tsx");
    expect(screen).toContain("LOCKED_DISPLAY_CURRENCY");
    expect(screen).toContain("label}>Currency<");
    expect(screen).not.toMatch(/Picker|Select|EUR|JPY/);
    expect(screen).not.toContain("onChangeText={setCurrency}");
    expect(screen).not.toContain("defaultCurrency");
  });

  it("app header USD uses the same locked constant", () => {
    const header = readRepoFile("apps/mobile/components/ui/app-header.tsx");
    expect(header).toContain("LOCKED_DISPLAY_CURRENCY");
    expect(header).not.toMatch(/Picker|Select|EUR|JPY/);
  });

  it("client save still sends locked USD, not a requested currency", () => {
    const preferences = readRepoFile("apps/mobile/lib/preferences.ts");
    expect(preferences).toContain("withLockedDisplayCurrency(preferences)");
    expect(preferences).toContain("LOCKED_DISPLAY_CURRENCY");
  });
});
