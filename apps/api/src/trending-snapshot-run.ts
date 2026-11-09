import { desc, eq, lt } from "drizzle-orm";
import { utcDateString } from "@cardflow/shared";
import { pokemonTcgPriceSnapshots, pokemonTcgSnapshotRuns } from "./db/schema";
import type { SqliteStorePort } from "./sqlite-store";

export const TRENDING_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const TRENDING_SNAPSHOT_MIN_GAP_MS = 20 * 60 * 60 * 1000;
export const TRENDING_SNAPSHOT_RETENTION_DAYS = 90;
export const TRENDING_SNAPSHOT_CRON = "0 6 * * *";

export function trendingSnapshotEnabledFromEnv(env: NodeJS.Dict<string | undefined> = process.env): boolean {
  const explicit = env.CARD_FLOW_TRENDING_SNAPSHOT_ENABLED?.trim().toLowerCase();
  if (explicit) return ["1", "true", "on", "yes"].includes(explicit);
  const trending = env.CARD_FLOW_TRENDING_ENABLED?.trim().toLowerCase();
  return ["1", "true", "on", "yes"].includes(trending ?? "");
}

export function trendingSnapshotIntervalMsFromEnv(env: NodeJS.Dict<string | undefined> = process.env): number {
  const raw = env.CARD_FLOW_TRENDING_SNAPSHOT_INTERVAL_MS?.trim();
  if (!raw) return TRENDING_SNAPSHOT_INTERVAL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : TRENDING_SNAPSHOT_INTERVAL_MS;
}

export type TrendingPriceSource = "tcgcsv" | "pokemontcg";

export function trendingPriceSourceFromEnv(
  env: NodeJS.Dict<string | undefined> = process.env,
): TrendingPriceSource {
  const raw = env.CARD_FLOW_TRENDING_PRICE_SOURCE?.trim().toLowerCase();
  if (raw === "pokemontcg" || raw === "pokemontcg.io" || raw === "pokemon-tcg") return "pokemontcg";
  return "tcgcsv";
}

export interface SnapshotRunResult {
  ok: boolean;
  status: "success" | "failed" | "skipped";
  runId: string;
  snapshotDate: string | null;
  pagesFetched: number;
  cardsSeen: number;
  snapshotsWritten: number;
  matched: number;
  unmatched: number;
  maxTcgplayerUpdatedAt: string | null;
  skipped?: boolean;
  error?: string;
  priceSource?: TrendingPriceSource;
}

export interface LatestSuccessfulRun {
  snapshotDate: string;
  finishedAt: string;
  maxTcgplayerUpdatedAt: string | null;
}

export function emptySnapshotResult(
  runId: string,
  snapshotDate: string | null,
  extras: Partial<SnapshotRunResult> = {},
): SnapshotRunResult {
  return {
    ok: true,
    status: "success",
    runId,
    snapshotDate,
    pagesFetched: 0,
    cardsSeen: 0,
    snapshotsWritten: 0,
    matched: 0,
    unmatched: 0,
    maxTcgplayerUpdatedAt: null,
    ...extras,
  };
}

export function latestSuccessfulRun(store: SqliteStorePort): LatestSuccessfulRun | null {
  const row = store.db
    .select({
      snapshotDate: pokemonTcgSnapshotRuns.snapshotDate,
      finishedAt: pokemonTcgSnapshotRuns.finishedAt,
      maxTcgplayerUpdatedAt: pokemonTcgSnapshotRuns.maxTcgplayerUpdatedAt,
    })
    .from(pokemonTcgSnapshotRuns)
    .where(eq(pokemonTcgSnapshotRuns.status, "success"))
    .orderBy(desc(pokemonTcgSnapshotRuns.finishedAt))
    .limit(1)
    .all()[0];
  if (!row?.snapshotDate || !row.finishedAt) return null;
  return {
    snapshotDate: row.snapshotDate,
    finishedAt: row.finishedAt,
    maxTcgplayerUpdatedAt: row.maxTcgplayerUpdatedAt ?? null,
  };
}

export function skipIfAlreadyRan(
  store: SqliteStorePort,
  now: Date,
  force: boolean | undefined,
  runId: string,
): SnapshotRunResult | null {
  if (force) return null;
  const snapshotDate = utcDateString(now);
  const last = latestSuccessfulRun(store);
  if (last?.snapshotDate === snapshotDate) {
    return emptySnapshotResult(runId, snapshotDate, { status: "skipped", skipped: true });
  }
  if (last?.finishedAt) {
    const gap = now.getTime() - Date.parse(last.finishedAt);
    if (Number.isFinite(gap) && gap < TRENDING_SNAPSHOT_MIN_GAP_MS) {
      return emptySnapshotResult(runId, last.snapshotDate, { status: "skipped", skipped: true });
    }
  }
  return null;
}

export function insertRunningSnapshot(
  store: SqliteStorePort,
  runId: string,
  startedAt: string,
  snapshotDate: string,
): void {
  store.db
    .insert(pokemonTcgSnapshotRuns)
    .values({
      runId,
      startedAt,
      status: "running",
      snapshotDate,
    })
    .run();
}

export function writeSnapshotRun(
  store: SqliteStorePort,
  runId: string,
  result: SnapshotRunResult,
  startedAt?: string,
): void {
  const finishedAt = new Date().toISOString();
  const existing = store.db
    .select({ runId: pokemonTcgSnapshotRuns.runId })
    .from(pokemonTcgSnapshotRuns)
    .where(eq(pokemonTcgSnapshotRuns.runId, runId))
    .all()[0];
  const values = {
    finishedAt,
    status: result.status === "skipped" ? "success" : result.status,
    snapshotDate: result.snapshotDate,
    pagesFetched: result.pagesFetched,
    cardsSeen: result.cardsSeen,
    snapshotsWritten: result.snapshotsWritten,
    matched: result.matched,
    unmatched: result.unmatched,
    maxTcgplayerUpdatedAt: result.maxTcgplayerUpdatedAt,
    error: result.error ?? null,
  };
  if (existing) {
    store.db.update(pokemonTcgSnapshotRuns).set(values).where(eq(pokemonTcgSnapshotRuns.runId, runId)).run();
    return;
  }
  store.db
    .insert(pokemonTcgSnapshotRuns)
    .values({
      runId,
      startedAt: startedAt ?? finishedAt,
      ...values,
    })
    .run();
}

export function pruneOldPriceSnapshots(store: SqliteStorePort, now: Date): void {
  const cutoff = utcDateString(new Date(now.getTime() - TRENDING_SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000));
  store.db.delete(pokemonTcgPriceSnapshots).where(lt(pokemonTcgPriceSnapshots.snapshotDate, cutoff)).run();
}
