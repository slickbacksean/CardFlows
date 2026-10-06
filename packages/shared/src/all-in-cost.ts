import { centsToDollarString, dollarsToCents } from "./money";
import type { AllInCostComputation, AllInCostInput } from "./types";

function lineToCents(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined || amount === "") return 0;
  return dollarsToCents(amount);
}

export function computeAllInCost(input: AllInCostInput): AllInCostComputation {
  const purchasePriceCents = dollarsToCents(input.purchasePrice);
  const shippingCents = lineToCents(input.shipping);
  const taxCents = lineToCents(input.tax);
  const feesCents = lineToCents(input.fees);
  const suppliesCents = lineToCents(input.supplies);
  const allInTotalCents =
    purchasePriceCents + shippingCents + taxCents + feesCents + suppliesCents;

  return {
    purchasePrice: centsToDollarString(purchasePriceCents),
    shipping: centsToDollarString(shippingCents),
    tax: centsToDollarString(taxCents),
    fees: centsToDollarString(feesCents),
    supplies: centsToDollarString(suppliesCents),
    allInTotal: centsToDollarString(allInTotalCents),
    allInTotalCents,
  };
}
