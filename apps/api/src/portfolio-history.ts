import { centsToDollarString } from "@cardflow/shared";
import type { PortfolioValueSnapshot } from "./store";

export const PORTFOLIO_HISTORY_RANGES = ["7d", "30d", "90d", "all"] as const;
export type PortfolioHistoryRange = (typeof PORTFOLIO_HISTORY_RANGES)[number];

const RANGE_DAYS: Record<Exclude<PortfolioHistoryRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Server-local calendar day (`YYYY-MM-DD`). One snapshot per user per day. */
export function localDateKey(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function parsePortfolioHistoryRange(raw: string | undefined): PortfolioHistoryRange | null {
  if (raw === undefined || raw.trim() === "") return "all";
  const lowered = raw.trim().toLowerCase();
  return (PORTFOLIO_HISTORY_RANGES as readonly string[]).includes(lowered)
    ? (lowered as PortfolioHistoryRange)
    : null;
}

/** Inclusive first day for a range ending today, or null for `all`. */
export function portfolioRangeStartDate(range: PortfolioHistoryRange, now: Date): string | null {
  if (range === "all") return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (RANGE_DAYS[range] - 1));
  return localDateKey(start);
}

export interface PortfolioHistoryPoint {
  date: string;
  amountCents: number;
  amount: string;
  pricedCopies: number;
  totalCopies: number;
  recordedAt: string;
}

export function portfolioHistoryPoint(snapshot: PortfolioValueSnapshot): PortfolioHistoryPoint {
  return {
    date: snapshot.date,
    amountCents: snapshot.amountCents,
    amount: centsToDollarString(snapshot.amountCents),
    pricedCopies: snapshot.pricedCopies,
    totalCopies: snapshot.totalCopies,
    recordedAt: snapshot.recordedAt,
  };
}
