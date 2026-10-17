/**
 * D10 / P1-20 North Star: cards marked Purchased per weekly active reseller.
 * Week = ISO week starting Monday 00:00 UTC. A weekly active reseller is a signed-in
 * (non-guest) account with at least one scan or Purchased card that week.
 */
export const NORTH_STAR_NAME = "Cards marked Purchased per weekly active reseller";
/** Sean: shown next to the North Star. */
export const SCANS_PER_WAR_NAME = "Scans per weekly active reseller";

export interface NorthStarUserActivity {
  userId: string;
  /** ISO timestamps of scans. */
  scans: string[];
  /** ISO timestamps of cards marked Purchased (one per physical copy row). */
  purchases: string[];
}

export interface NorthStarWeek {
  weekStart: string;
  purchased: number;
  activeResellers: number;
  /** purchased / activeResellers, 2 dp; null when nobody was active. */
  perActiveReseller: number | null;
  scans: number;
  /** scans / activeResellers, 2 dp; null when nobody was active. */
  scansPerActiveReseller: number | null;
}

/**
 * Backend review H2 (P4): one deleted account's weekly counts, kept as anonymous totals so past
 * weeks don't change after its rows are hard-deleted. activeResellers is 1 per week the account
 * was active (each account is one distinct reseller, so totals add without double counting).
 */
export interface NorthStarWeekTotal {
  weekStart: string;
  purchased: number;
  scans: number;
  activeResellers: number;
}

/** Pure: a user's activity rolled into per-week totals (every week, not just the last N). */
export function northStarUserWeekTotals(user: Pick<NorthStarUserActivity, "scans" | "purchases">): NorthStarWeekTotal[] {
  const weeks = new Map<string, NorthStarWeekTotal>();
  const week = (iso: string) => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return undefined;
    const weekStart = isoWeekStart(t).toISOString().slice(0, 10);
    let row = weeks.get(weekStart);
    if (!row) weeks.set(weekStart, (row = { weekStart, purchased: 0, scans: 0, activeResellers: 1 }));
    return row;
  };
  for (const at of user.scans) {
    const row = week(at);
    if (row) row.scans += 1;
  }
  for (const at of user.purchases) {
    const row = week(at);
    if (row) row.purchased += 1;
  }
  return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function isoWeekStart(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = d.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

export function northStarWeekly(
  users: NorthStarUserActivity[],
  options: { weeks?: number; now?: Date; totals?: readonly NorthStarWeekTotal[] } = {},
): NorthStarWeek[] {
  const weeks = Math.min(52, Math.max(1, Math.floor(options.weeks ?? 8)));
  const current = isoWeekStart(options.now ?? new Date());
  const starts = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(current);
    d.setUTCDate(d.getUTCDate() - 7 * (weeks - 1 - i));
    return d.toISOString().slice(0, 10);
  });
  const index = new Map(starts.map((s, i) => [s, i]));
  const purchased = new Array<number>(weeks).fill(0);
  const scans = new Array<number>(weeks).fill(0);
  const active = starts.map(() => new Set<string>());
  const bucket = (iso: string) => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return undefined;
    return index.get(isoWeekStart(t).toISOString().slice(0, 10));
  };
  for (const user of users) {
    for (const at of user.scans) {
      const i = bucket(at);
      if (i === undefined) continue;
      scans[i]! += 1;
      active[i]!.add(user.userId);
    }
    for (const at of user.purchases) {
      const i = bucket(at);
      if (i === undefined) continue;
      purchased[i]! += 1;
      active[i]!.add(user.userId);
    }
  }
  // Deleted accounts: their weekly totals (H2), added to the live rows.
  const extraActive = new Array<number>(weeks).fill(0);
  for (const total of options.totals ?? []) {
    const i = index.get(total.weekStart);
    if (i === undefined) continue;
    purchased[i]! += total.purchased;
    scans[i]! += total.scans;
    extraActive[i]! += total.activeResellers;
  }
  return starts.map((weekStart, i) => {
    const n = active[i]!.size + extraActive[i]!;
    return {
      weekStart,
      purchased: purchased[i]!,
      activeResellers: n,
      perActiveReseller: n === 0 ? null : Math.round((purchased[i]! / n) * 100) / 100,
      scans: scans[i]!,
      scansPerActiveReseller: n === 0 ? null : Math.round((scans[i]! / n) * 100) / 100,
    };
  });
}
