/**
 * D10 / P1-20 North Star: cards marked Purchased per weekly active reseller.
 * Week = ISO week starting Monday 00:00 UTC. A weekly active reseller is a signed-in
 * (non-guest) account with at least one scan or Purchased card that week.
 */
export const NORTH_STAR_NAME = "Cards marked Purchased per weekly active reseller";

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
}

export function isoWeekStart(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = d.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

export function northStarWeekly(users: NorthStarUserActivity[], options: { weeks?: number; now?: Date } = {}): NorthStarWeek[] {
  const weeks = Math.min(52, Math.max(1, Math.floor(options.weeks ?? 8)));
  const current = isoWeekStart(options.now ?? new Date());
  const starts = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(current);
    d.setUTCDate(d.getUTCDate() - 7 * (weeks - 1 - i));
    return d.toISOString().slice(0, 10);
  });
  const index = new Map(starts.map((s, i) => [s, i]));
  const purchased = new Array<number>(weeks).fill(0);
  const active = starts.map(() => new Set<string>());
  const bucket = (iso: string) => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return undefined;
    return index.get(isoWeekStart(t).toISOString().slice(0, 10));
  };
  for (const user of users) {
    for (const at of user.scans) {
      const i = bucket(at);
      if (i !== undefined) active[i]!.add(user.userId);
    }
    for (const at of user.purchases) {
      const i = bucket(at);
      if (i === undefined) continue;
      purchased[i]! += 1;
      active[i]!.add(user.userId);
    }
  }
  return starts.map((weekStart, i) => {
    const n = active[i]!.size;
    return {
      weekStart,
      purchased: purchased[i]!,
      activeResellers: n,
      perActiveReseller: n === 0 ? null : Math.round((purchased[i]! / n) * 100) / 100,
    };
  });
}
