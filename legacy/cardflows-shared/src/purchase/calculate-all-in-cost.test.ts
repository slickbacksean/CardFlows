import { describe, expect, it } from 'vitest';
import { calculateAllInCost } from './calculate-all-in-cost.js';

describe('calculateAllInCost', () => {
  it('calculates all-in cost with all fields provided', () => {
    const result = calculateAllInCost({
      currency: 'USD',
      purchasePrice: '3.50',
      purchasedAt: '2026-09-12T16:06:40.000Z',
      shipping: '0.00',
      tax: '0.29',
      fees: '0.00',
      supplies: '0.25',
    });

    expect(result.currency).toBe('USD');
    expect(result.purchasedAt).toBe('2026-09-12T16:06:40.000Z');
    expect(result.purchasePrice).toBe('3.50');
    expect(result.shipping).toBe('0.00');
    expect(result.tax).toBe('0.29');
    expect(result.fees).toBe('0.00');
    expect(result.supplies).toBe('0.25');
    expect(result.allInTotal).toBe('4.04');

    expect(result.purchasePriceCents).toBe(350);
    expect(result.shippingCents).toBe(0);
    expect(result.taxCents).toBe(29);
    expect(result.feesCents).toBe(0);
    expect(result.suppliesCents).toBe(25);
    expect(result.allInTotalCents).toBe(404);
  });

  it('defaults optional fields to zero when omitted', () => {
    const result = calculateAllInCost({
      currency: 'USD',
      purchasePrice: '15.00',
      purchasedAt: '2026-09-12T18:45:00.000Z',
    });

    expect(result.purchasePrice).toBe('15.00');
    expect(result.shipping).toBe('0.00');
    expect(result.tax).toBe('0.00');
    expect(result.fees).toBe('0.00');
    expect(result.supplies).toBe('0.00');
    expect(result.allInTotal).toBe('15.00');

    expect(result.purchasePriceCents).toBe(1500);
    expect(result.shippingCents).toBe(0);
    expect(result.taxCents).toBe(0);
    expect(result.feesCents).toBe(0);
    expect(result.suppliesCents).toBe(0);
    expect(result.allInTotalCents).toBe(1500);
  });

  it('handles partial optional fields', () => {
    const result = calculateAllInCost({
      currency: 'USD',
      purchasePrice: '10.00',
      purchasedAt: '2026-09-12T12:00:00.000Z',
      shipping: '2.50',
      tax: '0.85',
    });

    expect(result.purchasePrice).toBe('10.00');
    expect(result.shipping).toBe('2.50');
    expect(result.tax).toBe('0.85');
    expect(result.fees).toBe('0.00');
    expect(result.supplies).toBe('0.00');
    expect(result.allInTotal).toBe('13.35');

    expect(result.allInTotalCents).toBe(1335);
  });

  it('handles decimal cents correctly', () => {
    const result = calculateAllInCost({
      currency: 'USD',
      purchasePrice: '1.23',
      purchasedAt: '2026-09-12T12:00:00.000Z',
      shipping: '0.45',
      tax: '0.67',
      fees: '0.01',
      supplies: '0.89',
    });

    expect(result.allInTotal).toBe('3.25');
    expect(result.allInTotalCents).toBe(325);
  });

  it('handles single digit cents', () => {
    const result = calculateAllInCost({
      currency: 'USD',
      purchasePrice: '5.05',
      purchasedAt: '2026-09-12T12:00:00.000Z',
      tax: '0.04',
    });

    expect(result.purchasePrice).toBe('5.05');
    expect(result.tax).toBe('0.04');
    expect(result.allInTotal).toBe('5.09');
    expect(result.allInTotalCents).toBe(509);
  });

  it('throws error for invalid dollar amounts', () => {
    expect(() =>
      calculateAllInCost({
        currency: 'USD',
        purchasePrice: 'invalid',
        purchasedAt: '2026-09-12T12:00:00.000Z',
      })
    ).toThrow('Invalid dollar amount');
  });

  it('throws error for invalid optional amounts', () => {
    expect(() =>
      calculateAllInCost({
        currency: 'USD',
        purchasePrice: '10.00',
        purchasedAt: '2026-09-12T12:00:00.000Z',
        shipping: 'not-a-number',
      })
    ).toThrow('Invalid dollar amount');
  });
});
