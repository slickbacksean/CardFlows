/** Max Buy preferences and the stateless Max Buy calculator. Contract: `accountRoutes`. */
import {
  computeMaxBuy,
  INVALID_DOLLAR_AMOUNT,
  LOCKED_DISPLAY_CURRENCY,
  maxBuyPreferencesRangeError,
  parseDollarsToCents,
  type MaxBuyPreferences,
} from "@cardflow/shared";
import type { CardFlowApp } from "../app-env";

export interface PreferenceRouteDeps {
  getPreferences(userId: string): MaxBuyPreferences;
  setPreferences(userId: string, preferences: MaxBuyPreferences): MaxBuyPreferences;
}

export function registerPreferenceRoutes(app: CardFlowApp, deps: PreferenceRouteDeps): void {
  const { getPreferences, setPreferences } = deps;

  app.get("/v1/preferences", (c) =>
    c.json({ ok: true, preferences: getPreferences(c.get("userId")) }),
  );

  app.patch("/v1/preferences", async (c) => {
    const body = await c.req.json<Partial<MaxBuyPreferences>>();
    const userId = c.get("userId");
    const current = getPreferences(userId);
    const next: MaxBuyPreferences = {
      targetMarginPct:
        body.targetMarginPct === undefined ? current.targetMarginPct : body.targetMarginPct,
      feesBufferPct:
        body.feesBufferPct === undefined ? current.feesBufferPct : body.feesBufferPct,
      defaultCurrency: LOCKED_DISPLAY_CURRENCY,
      conditionAdjustments:
        body.conditionAdjustments === undefined
          ? current.conditionAdjustments
          : body.conditionAdjustments,
    };
    const rangeError = maxBuyPreferencesRangeError(next);
    if (rangeError) {
      return c.json({ ok: false, error: rangeError }, 400);
    }
    return c.json({ ok: true, preferences: setPreferences(userId, next) });
  });

  app.post("/v1/max-buy", async (c) => {
    const body = await c.req.json<{
      referencePriceAmount?: string | number | null;
      condition?: string | null;
    }>();
    const maxBuyReference = body.referencePriceAmount ?? null;
    if (
      maxBuyReference !== null &&
      maxBuyReference !== "" &&
      parseDollarsToCents(maxBuyReference) === null
    ) {
      return c.json({ ok: false, error: INVALID_DOLLAR_AMOUNT }, 400);
    }
    const maxBuy = computeMaxBuy({
      referencePriceAmount: maxBuyReference,
      condition: body.condition,
      preferences: getPreferences(c.get("userId")),
    });
    return c.json({ ok: true, maxBuy });
  });
}
