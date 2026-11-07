import { FEATURE_DISABLED_HEADER, featureDisabledBody } from "@cardflow/shared";
import type { Context } from "hono";
import type { CardFlowApp } from "../app-env";
import { emptyTrendingPayload, loadTrendingPayload } from "../trending";
import { parseTrendingWindow } from "@cardflow/shared";
import type { SqliteStorePort } from "../sqlite-store";
import type { SnapshotRunResult } from "../pokemon-tcg-snapshot-job";

export interface TrendingRouteDeps {
  trendingEnabled: () => boolean;
  sqliteStore: SqliteStorePort | null;
  runSnapshot?: (force: boolean) => Promise<SnapshotRunResult>;
  opsToken: string | null;
  timingSafeEqualString: (given: string, expected: string) => boolean;
  now?: () => Date;
}

export function registerTrendingRoutes(app: CardFlowApp, deps: TrendingRouteDeps): void {
  app.get("/v1/trending", (c) => getTrending(c, deps));
  app.post("/ops/trending/snapshot", (c) => postTrendingSnapshot(c, deps));
}

export function getTrending(c: Context, deps: TrendingRouteDeps): Response {
  if (!deps.trendingEnabled()) {
    c.header(FEATURE_DISABLED_HEADER, "trending");
    return c.json(featureDisabledBody("trending"), 503);
  }
  const window = parseTrendingWindow(c.req.query("window"));
  if (!deps.sqliteStore) {
    return c.json(emptyTrendingPayload(window, deps.now?.()));
  }
  return c.json(
    loadTrendingPayload(deps.sqliteStore, {
      window: c.req.query("window"),
      limit: c.req.query("limit"),
      now: deps.now?.(),
    }),
  );
}

export async function postTrendingSnapshot(c: Context, deps: TrendingRouteDeps): Promise<Response> {
  const expected = deps.opsToken?.trim();
  const given = c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected) return c.json({ ok: false, error: "Not found" }, 404);
  if (!given || !deps.timingSafeEqualString(given, expected)) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }
  if (!deps.runSnapshot) {
    return c.json({ ok: false, status: "failed", error: "Snapshot job needs SQLite" }, 503);
  }
  const force = ["1", "true", "yes", "on"].includes((c.req.query("force") ?? "").toLowerCase());
  const result = await deps.runSnapshot(force);
  return c.json({
    ok: result.ok,
    status: result.status,
    snapshotDate: result.snapshotDate,
    cardsSeen: result.cardsSeen,
    snapshotsWritten: result.snapshotsWritten,
    matched: result.matched,
    unmatched: result.unmatched,
    skipped: result.skipped,
    error: result.error,
  });
}