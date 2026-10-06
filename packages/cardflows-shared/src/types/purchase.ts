export interface PurchaseCostInput {
  /** Required: ISO 4217 currency code (e.g. "USD") */
  currency: string;
  /** Required: Purchase price in dollars as decimal string (e.g. "3.50") */
  purchasePrice: string;
  /** Required: When the purchase occurred */
  purchasedAt: string;
  /** Optional: Inbound shipping allocated to this copy (dollars) */
  shipping?: string;
  /** Optional: Sales tax / VAT allocated to this copy (dollars) */
  tax?: string;
  /** Optional: Buy-side platform or payment fees (dollars) */
  fees?: string;
  /** Optional: Sleeves, toploaders, penny sleeves allocated to this copy (dollars) */
  supplies?: string;
}

export interface PurchaseCostResult {
  currency: string;
  purchasedAt: string;
  /** Display dollars for each field */
  purchasePrice: string;
  shipping: string;
  tax: string;
  fees: string;
  supplies: string;
  /** Computed all-in total in display dollars */
  allInTotal: string;
  /** Persisted minor units (cents) for each field */
  purchasePriceCents: number;
  shippingCents: number;
  taxCents: number;
  feesCents: number;
  suppliesCents: number;
  /** Computed all-in total in cents */
  allInTotalCents: number;
}
