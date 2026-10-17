import type Database from "better-sqlite3";
import { quotaPeriodFor } from "@cardflow/shared";

type Sqlite = InstanceType<typeof Database>;

/** Columns that record when the user did something (not user-entered dates like `purchased_at`). */
const ACTIVITY_COLUMNS = ["created_at", "captured_at", "recorded_at"] as const;
/** `purchase_events.at` is backfilled from `purchased_at` (user-entered), so it isn't activity. */
const SKIP_TABLES = new Set(["grade_accounts", "grade_quota_usage", "purchase_events", "__drizzle_migrations"]);

const isIso = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/**
 * Sean: the allowance resets on the billing date, or the account creation date for free users.
 * Accounts that existed before 0016 have no `anchor_at`; give them one once:
 *   1. `billing_anchor_at` if set (none today), else
 *   2. `user_accounts.created_at` (sign-up), else
 *   3. the earliest known activity (scans, sessions, inventory, history …), else
 *   4. the earliest usage month (`YYYY-MM` → the 1st), else `updated_at`, else now.
 * The usage they already have this calendar month (`YYYY-MM`, the old key) becomes the usage of
 * their in-progress period, and their credits stay live in that period (no reset on migration).
 * Only rows with `anchor_at IS NULL` are touched, so this is safe to run on every start.
 */
export function backfillQuotaAnchors(sqlite: Sqlite, now: Date = new Date()): number {
  const pending = sqlite
    .prepare("SELECT user_id, billing_anchor_at, updated_at FROM grade_accounts WHERE anchor_at IS NULL")
    .all() as Array<{ user_id: string; billing_anchor_at: string | null; updated_at: string | null }>;
  if (pending.length === 0) return 0;

  const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
    .map((t) => t.name)
    .filter((name) => !SKIP_TABLES.has(name));
  const activitySources: string[] = [];
  for (const table of tables) {
    const cols = new Set((sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name));
    if (!cols.has("user_id")) continue;
    for (const col of ACTIVITY_COLUMNS) {
      if (cols.has(col)) activitySources.push(`SELECT MIN("${col}") AS t FROM "${table}" WHERE user_id = @u`);
    }
  }
  const hasAccounts = tables.includes("user_accounts");
  const createdStmt = hasAccounts ? sqlite.prepare("SELECT created_at AS t FROM user_accounts WHERE user_id = ?") : null;
  const activityStmt = activitySources.length
    ? sqlite.prepare(`SELECT MIN(t) AS t FROM (${activitySources.join(" UNION ALL ")}) WHERE t IS NOT NULL`)
    : null;
  const firstUsageStmt = sqlite.prepare("SELECT MIN(month_key) AS m FROM grade_quota_usage WHERE user_id = ? AND length(month_key) = 7");
  const usageStmt = sqlite.prepare("SELECT used FROM grade_quota_usage WHERE user_id = ? AND month_key = ?");
  const putUsage = sqlite.prepare(
    `INSERT INTO grade_quota_usage (user_id, month_key, used) VALUES (?, ?, ?)
     ON CONFLICT (user_id, month_key) DO UPDATE SET used = MAX(used, excluded.used)`,
  );
  const setAnchor = sqlite.prepare(
    "UPDATE grade_accounts SET anchor_at = ?, credits_period = COALESCE(credits_period, ?) WHERE user_id = ? AND anchor_at IS NULL",
  );
  const calendarKey = now.toISOString().slice(0, 7);

  const run = sqlite.transaction(() => {
    for (const row of pending) {
      const created = (createdStmt?.get(row.user_id) as { t: string | null } | undefined)?.t;
      const activity = (activityStmt?.get({ u: row.user_id }) as { t: string | null } | undefined)?.t;
      const firstMonth = (firstUsageStmt.get(row.user_id) as { m: string | null } | undefined)?.m;
      const candidates = [
        row.billing_anchor_at,
        created,
        activity,
        firstMonth ? `${firstMonth}-01T00:00:00.000Z` : null,
        row.updated_at,
      ];
      const picked = candidates.find(isIso);
      const anchor = new Date(picked ? Math.min(Date.parse(picked), now.getTime()) : now.getTime()).toISOString();
      const period = quotaPeriodFor(anchor, now);
      const used = (usageStmt.get(row.user_id, calendarKey) as { used: number } | undefined)?.used;
      if (used !== undefined && used > 0) putUsage.run(row.user_id, period.key, used);
      setAnchor.run(anchor, period.key, row.user_id);
    }
  });
  run();
  return pending.length;
}
