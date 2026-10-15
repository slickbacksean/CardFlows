/**
 * P1-13: the tap-to-see math behind Max Buy on Confirm.
 *   reference price − fees − margin − condition = Max Buy
 * The lines always add up to exactly what `computeMaxBuy` returns. Max Buy is
 * your own buying rule, never a market price, and never a profit promise.
 */
import { MAX_BUY_NOT_MARKET_PRICE_DISCLAIMER } from "./max-buy";
import { centsToDollarString, roundHalfUpToCent } from "./money";
import type { MaxBuyComputation } from "./types";

export const MAX_BUY_BREAKDOWN_TITLE = "How Max Buy is worked out" as const;
export const MAX_BUY_BREAKDOWN_SHOW = "Show the math" as const;
export const MAX_BUY_BREAKDOWN_HIDE = "Hide the math" as const;
export const MAX_BUY_BREAKDOWN_NOTE =
  "Max Buy is your own buying rule. It is not a market price and doesn't promise a profit." as const;

export interface MaxBuyBreakdownLine {
  id: "reference" | "fees" | "margin" | "condition" | "max_buy";
  label: string;
  /** Signed dollars, e.g. "-1.04". The reference and Max Buy lines are positive. */
  amount: string;
  cents: number;
}

export interface MaxBuyBreakdown {
  lines: MaxBuyBreakdownLine[];
  note: string;
  disclaimer: string;
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const signed = (cents: number) => (cents === 0 ? "0.00" : `-${centsToDollarString(Math.abs(cents))}`);

export function maxBuyBreakdown(m: MaxBuyComputation): MaxBuyBreakdown | null {
  if (m.referencePriceCents === null || m.maxBuyAmountCents === null) return null;
  const ref = m.referencePriceCents;
  const afterFees = roundHalfUpToCent(ref * (1 - m.currentFeesBufferPct));
  const afterMargin = roundHalfUpToCent(afterFees * (1 - m.currentTargetMarginPct));
  const final = m.maxBuyAmountCents;
  const fees = ref - afterFees;
  const margin = afterFees - afterMargin;
  // Whatever is left (condition plus any rounding) goes on the condition line, so it always adds up.
  const condition = afterMargin - final;
  const conditionLabel =
    m.currentConditionFactor === 1
      ? `Condition${m.condition ? ` (${m.condition})` : ""} × 1`
      : `Condition (${m.condition ?? "—"}) × ${m.currentConditionFactor}`;
  return {
    lines: [
      { id: "reference", label: "Reference price", amount: centsToDollarString(ref), cents: ref },
      { id: "fees", label: `Fees ${pct(m.currentFeesBufferPct)}`, amount: signed(fees), cents: -fees },
      { id: "margin", label: `Your margin ${pct(m.currentTargetMarginPct)}`, amount: signed(margin), cents: -margin },
      { id: "condition", label: conditionLabel, amount: signed(condition), cents: -condition },
      { id: "max_buy", label: "Max Buy (your rule)", amount: centsToDollarString(final), cents: final },
    ],
    note: MAX_BUY_BREAKDOWN_NOTE,
    disclaimer: MAX_BUY_NOT_MARKET_PRICE_DISCLAIMER,
  };
}

export function maxBuyBreakdownCopy(): string[] {
  return [MAX_BUY_BREAKDOWN_TITLE, MAX_BUY_BREAKDOWN_SHOW, MAX_BUY_BREAKDOWN_HIDE, MAX_BUY_BREAKDOWN_NOTE];
}
