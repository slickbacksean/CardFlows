import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('CardFlow API routes', () => {
  const app = createApp();

  it('GET /health returns mock provider', async () => {
    const response = await app.request('/health');
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('mock');
    expect(body.store).toBeDefined();
  });

  it('POST /v1/max-buy/compute matches fixture $8.00 → $5.57', async () => {
    const response = await app.request('/v1/max-buy/compute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referencePriceAmount: '8.00',
        condition: 'NM',
        preferences: {
          maxBuyTargetMarginPct: 0.2,
          maxBuyFeesBufferPct: 0.13,
          maxBuyConditionAdjustmentsJson: { NM: 1.0 },
          defaultCurrency: 'USD',
        },
      }),
    });

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.maxBuy.maxBuyAmount).toBe('5.57');
    expect(body.maxBuy.maxBuyAmountCents).toBe(557);
    expect(body.uiCopy.display).toContain('$5.57');
  });

  it('POST /v1/catalog/map returns mocked high-confidence mapping', async () => {
    const response = await app.request('/v1/catalog/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'en',
        setName: 'Base Set',
        number: '58',
        name: 'Pikachu',
        vendorCardId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      }),
    });

    const body = await response.json();
    expect(body._meta?.mocked).toBe(true);
    expect(body.tcgdexId).toBe('base1-58');
    expect(body.cardsightCardId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });
});
