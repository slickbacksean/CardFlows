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

  it('POST /v1/purchase/calculate-cost returns all-in cost with all fields', async () => {
    const response = await app.request('/v1/purchase/calculate-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currency: 'USD',
        purchasePrice: '3.50',
        purchasedAt: '2026-09-12T16:06:40.000Z',
        shipping: '0.00',
        tax: '0.29',
        fees: '0.00',
        supplies: '0.25',
      }),
    });

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.cost.allInTotal).toBe('4.04');
    expect(body.cost.allInTotalCents).toBe(404);
  });

  it('POST /v1/purchase/calculate-cost defaults optional fields to zero', async () => {
    const response = await app.request('/v1/purchase/calculate-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currency: 'USD',
        purchasePrice: '15.00',
        purchasedAt: '2026-09-12T18:45:00.000Z',
      }),
    });

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.cost.allInTotal).toBe('15.00');
    expect(body.cost.allInTotalCents).toBe(1500);
    expect(body.cost.shipping).toBe('0.00');
    expect(body.cost.tax).toBe('0.00');
    expect(body.cost.fees).toBe('0.00');
    expect(body.cost.supplies).toBe('0.00');
  });

  it('POST /v1/purchase/calculate-cost returns 400 for missing required fields', async () => {
    const response = await app.request('/v1/purchase/calculate-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currency: 'USD',
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });

  it('POST /v1/purchase/calculate-cost returns 400 for invalid dollar amounts', async () => {
    const response = await app.request('/v1/purchase/calculate-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currency: 'USD',
        purchasePrice: 'invalid',
        purchasedAt: '2026-09-12T12:00:00.000Z',
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toContain('Invalid dollar amount');
  });
});
