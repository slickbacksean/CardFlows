/**
 * P2-02: scan-to-listing draft builder helpers — a readiness indicator and an
 * "Estimated spread" line that names its price source and time. Spread is a
 * cost-to-ask gap, never profit, and nothing here promises a sale.
 */
import { DISCLOSURE_ITEMS } from "./listing-draft";
import { centsToDollarString, optionalDollarsToCents } from "./money";
import { PREGRADE_TITLE } from "./pregrade-copy";

export const MAKE_LISTING_LABEL = "Purchased + make listing" as const;
export const ESTIMATED_SPREAD_LABEL = "Estimated spread" as const;
export const ESTIMATED_SPREAD_NOTE =
  "Estimate only. Your asking price minus your all-in cost. Not profit, and a sale isn't guaranteed." as const;

export type ListingReadinessStepId = "title" | "condition" | "asking_price" | "disclosures";

export interface ListingReadiness {
  steps: Array<{ id: ListingReadinessStepId; label: string; done: boolean }>;
  done: number;
  total: number;
  /** "3 of 4 ready" */
  label: string;
  readyToCopy: boolean;
}

export function listingReadiness(input: {
  title: string;
  condition: string | null | undefined;
  askingPrice: string | null | undefined;
  disclosure: Partial<Record<string, string | null | undefined>> | object;
}): ListingReadiness {
  const answered = DISCLOSURE_ITEMS.filter((item) => Boolean((input.disclosure as Record<string, unknown>)[item.id])).length;
  const steps = [
    { id: "title" as const, label: "Title", done: input.title.trim().length > 0 },
    { id: "condition" as const, label: "Condition", done: Boolean(input.condition?.trim()) },
    { id: "asking_price" as const, label: "Asking price", done: optionalDollarsToCents(input.askingPrice ?? null) !== null },
    {
      id: "disclosures" as const,
      label: `Condition notes (${answered}/${DISCLOSURE_ITEMS.length})`,
      done: answered === DISCLOSURE_ITEMS.length,
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: steps.length,
    label: `${done} of ${steps.length} ready`,
    // Title, condition and price are enough to copy; notes make it complete.
    readyToCopy: steps.slice(0, 3).every((s) => s.done),
  };
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * "Estimated spread $4.50 · your asking price vs all-in cost · Oct 14". Null
 * when either side is missing, so a missing cost never reads as $0.
 */
export function estimatedSpreadLine(input: {
  askingPrice: string | null | undefined;
  allInTotal: string | null | undefined;
  at?: string | null;
}): { amount: string; line: string; note: string } | null {
  const ask = optionalDollarsToCents(input.askingPrice ?? null);
  const cost = optionalDollarsToCents(input.allInTotal ?? null);
  if (ask === null || cost === null) return null;
  const cents = ask - cost;
  const amount = cents < 0 ? `-$${centsToDollarString(-cents)}` : `$${centsToDollarString(cents)}`;
  const d = input.at ? new Date(input.at) : null;
  const when = d && !Number.isNaN(d.getTime()) ? ` · ${MONTH[d.getMonth()]} ${d.getDate()}` : "";
  return {
    amount,
    line: `${ESTIMATED_SPREAD_LABEL} ${amount} · your asking price vs all-in cost${when}`,
    note: ESTIMATED_SPREAD_NOTE,
  };
}

/** The draft chip for an estimate never names a grading company. */
export const LISTING_PREGRADE_CHIP_PREFIX = PREGRADE_TITLE;
