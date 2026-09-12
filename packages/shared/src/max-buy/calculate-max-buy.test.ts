import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calculateMaxBuy } from './calculate-max-buy.js';
import type { MaxBuyUserPreferences } from '../types/max-buy.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

function loadFixture<T>(filename: string): T {
  const raw = JSON.parse(readFileSync(join(fixturesDir, filename), 'utf-8')) as T & {
    _meta?: { mocked?: boolean };
  };
  expect(raw._meta?.mocked).toBe(true);
  return raw;
}

describe('calculateMaxBuy', () => {
  it('computes $8.00 reference to $5.57 per max-buy-with-reference-price-example.json', () => {
    const fixture = loadFixture<{
      maxBuy: {
        referencePriceAmount: string;
        currentTargetMarginPct: number;
        currentFeesBufferPct: number;
        currentConditionFactor: number;
        condition: string;
        maxBuyAmount: string;
      };
      userPreferences: MaxBuyUserPreferences;
    }>('max-buy-with-reference-price-example.json');

    const result = calculateMaxBuy({
      referencePriceAmount: fixture.maxBuy.referencePriceAmount,
      referencePriceSource: 'user_entered',
      condition: fixture.maxBuy.condition,
      preferences: fixture.userPreferences,
    });

    expect(result.maxBuyAmount).toBe('5.57');
    expect(result.maxBuyAmountCents).toBe(557);
    expect(result.referencePriceAmount).toBe('8.00');
    expect(result.currentTargetMarginPct).toBe(0.2);
    expect(result.currentFeesBufferPct).toBe(0.13);
    expect(result.currentConditionFactor).toBe(1.0);
    expect(result.isRecomputedGuidance).toBe(true);
  });

  it('returns null max buy when reference is missing per max-buy-without-reference-price-example.json', () => {
    const fixture = loadFixture<{
      maxBuy: { maxBuyAmount: null; referencePriceAmount: null };
      userPreferences: MaxBuyUserPreferences;
    }>('max-buy-without-reference-price-example.json');

    const result = calculateMaxBuy({
      referencePriceAmount: fixture.maxBuy.referencePriceAmount,
      condition: null,
      preferences: fixture.userPreferences,
    });

    expect(result.maxBuyAmount).toBeNull();
    expect(result.maxBuyAmountCents).toBeNull();
    expect(result.referencePriceSource).toBe('none');
  });

  it('uses condition adjustment map when provided', () => {
    const result = calculateMaxBuy({
      referencePriceAmount: '10.00',
      condition: 'LP',
      preferences: {
        maxBuyTargetMarginPct: 0.2,
        maxBuyFeesBufferPct: 0.13,
        maxBuyConditionAdjustmentsJson: { NM: 1.0, LP: 0.85 },
        defaultCurrency: 'USD',
      },
    });

    // 10.00 * 0.80 * 0.87 * 0.85 = 5.916 -> 592 cents
    expect(result.maxBuyAmountCents).toBe(592);
    expect(result.maxBuyAmount).toBe('5.92');
    expect(result.currentConditionFactor).toBe(0.85);
  });
});
