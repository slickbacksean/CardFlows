/**
 * P1-12: your own reference prices. Each typed price is saved as a snapshot
 * (source "you", with a date) next to vendor snapshots, so Max Buy keeps
 * working when pricing is off or the vendor is down.
 */
import { centsToDollarString, parseDollarsToCents } from "./money";

export const USER_PRICE_SOURCE = "you" as const;
export const YOUR_PRICE_LABEL = "Your price" as const;
/** Upper bound for a typed price; anything above is almost surely a typo. */
export const USER_PRICE_MAX_CENTS = 10_000_000;
export const SAVE_YOUR_PRICE_LABEL = "Save your price" as const;
export const USE_PRICE_LABEL = "Use for Max Buy" as const;

export interface UserPriceSnapshot {
  snapshotId: string;
  tcgdexId: string;
  variant: string | null;
  amount: string;
  currency: "USD";
  source: typeof USER_PRICE_SOURCE;
  enteredAt: string;
}

export type PriceSnapshotOption =
  | { key: string; kind: "you"; amount: string; at: string; snapshotId: string }
  | { key: "vendor"; kind: "vendor"; amount: string; at: string | null; sourceLabel: string };

export function parseUserPriceAmount(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const cents = parseDollarsToCents(raw);
  if (cents === null || cents <= 0 || cents > USER_PRICE_MAX_CENTS) return null;
  return centsToDollarString(cents);
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Your price · Oct 13" (adds the year when it isn't this year). */
export function userPriceLabel(enteredAt: string, now: Date = new Date()): string {
  const d = new Date(enteredAt);
  if (Number.isNaN(d.getTime())) return YOUR_PRICE_LABEL;
  const day = `${MONTH[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear()
    ? `${YOUR_PRICE_LABEL} · ${day}`
    : `${YOUR_PRICE_LABEL} · ${day}, ${d.getFullYear()}`;
}

/** Your snapshots plus the vendor price (if any), newest first. */
export function priceSnapshotOptions(input: {
  userSnapshots: readonly UserPriceSnapshot[];
  vendor?: { amount: string | null | undefined; at: string | null | undefined; sourceLabel: string } | null;
}): PriceSnapshotOption[] {
  const options: PriceSnapshotOption[] = input.userSnapshots.map((s) => ({
    key: `you:${s.snapshotId}`,
    kind: "you",
    amount: s.amount,
    at: s.enteredAt,
    snapshotId: s.snapshotId,
  }));
  if (input.vendor?.amount) {
    options.push({
      key: "vendor",
      kind: "vendor",
      amount: input.vendor.amount,
      at: input.vendor.at ?? null,
      sourceLabel: input.vendor.sourceLabel,
    });
  }
  return options.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/**
 * The reference Max Buy uses: the snapshot the user picked, else the newest
 * one (yours or the vendor's). Null when there is nothing to go on.
 */
export function selectMaxBuyReference(
  options: readonly PriceSnapshotOption[],
  pickedKey?: string | null,
): PriceSnapshotOption | null {
  if (pickedKey) {
    const picked = options.find((o) => o.key === pickedKey);
    if (picked) return picked;
  }
  return options[0] ?? null;
}
