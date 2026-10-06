import type { PurchaseCostInput, PurchaseCostResult } from '../types/purchase.js';
import { centsToDollars, dollarsToCents } from '../max-buy/money.js';

/**
 * Calculate all-in cost from purchase price and optional cost breakdown.
 * Formula: all_in_total = purchase_price + shipping + tax + fees + supplies
 * 
 * Required fields: currency, purchasePrice, purchasedAt
 * Optional fields default to "0.00" if omitted
 * 
 * Persist amounts in cents, display in dollars.
 */
export function calculateAllInCost(input: PurchaseCostInput): PurchaseCostResult {
  // Required field
  const purchasePriceCents = dollarsToCents(input.purchasePrice);

  // Optional fields default to 0
  const shippingCents = input.shipping ? dollarsToCents(input.shipping) : 0;
  const taxCents = input.tax ? dollarsToCents(input.tax) : 0;
  const feesCents = input.fees ? dollarsToCents(input.fees) : 0;
  const suppliesCents = input.supplies ? dollarsToCents(input.supplies) : 0;

  // Compute all-in total
  const allInTotalCents = purchasePriceCents + shippingCents + taxCents + feesCents + suppliesCents;

  return {
    currency: input.currency,
    purchasedAt: input.purchasedAt,
    purchasePrice: centsToDollars(purchasePriceCents),
    shipping: centsToDollars(shippingCents),
    tax: centsToDollars(taxCents),
    fees: centsToDollars(feesCents),
    supplies: centsToDollars(suppliesCents),
    allInTotal: centsToDollars(allInTotalCents),
    purchasePriceCents,
    shippingCents,
    taxCents,
    feesCents,
    suppliesCents,
    allInTotalCents,
  };
}
