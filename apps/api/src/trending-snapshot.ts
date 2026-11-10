/**
 * Trending snapshot dispatcher. Default source is TCGCSV; pokemontcg.io remains a fallback.
 */
import { pokemonTcgApiKeyFromEnv } from "./pokemon-tcg-http";
import { runPokemonTcgSnapshot } from "./pokemon-tcg-snapshot-job";
import type { SqliteStorePort } from "./sqlite-store";
import { runTcgcsvSnapshot } from "./tcgcsv-snapshot-job";
import {
  TRENDING_SNAPSHOT_CRON,
  trendingPriceSourceFromEnv,
  trendingSnapshotEnabledFromEnv,
  trendingSnapshotIntervalMsFromEnv,
  type SnapshotRunResult,
  type TrendingPriceSource,
} from "./trending-snapshot-run";

export {
  TRENDING_SNAPSHOT_CRON,
  TRENDING_SNAPSHOT_INTERVAL_MS,
  TRENDING_SNAPSHOT_MIN_GAP_MS,
  TRENDING_SNAPSHOT_RETENTION_DAYS,
  trendingPriceSourceFromEnv,
  trendingSnapshotEnabledFromEnv,
  trendingSnapshotIntervalMsFromEnv,
} from "./trending-snapshot-run";
export type { SnapshotRunResult, TrendingPriceSource } from "./trending-snapshot-run";

export interface RunTrendingSnapshotOptions {
  store: SqliteStorePort;
  now?: Date;
  force?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  apiKey?: string;
  pageSize?: number;
  maxPages?: number;
  maxGroups?: number;
  priceSource?: TrendingPriceSource;
}

export async function runTrendingSnapshot(options: RunTrendingSnapshotOptions): Promise<SnapshotRunResult> {
  const priceSource = options.priceSource ?? trendingPriceSourceFromEnv();
  if (priceSource === "pokemontcg") {
    const result = await runPokemonTcgSnapshot({
      store: options.store,
      now: options.now,
      force: options.force,
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
      apiKey: options.apiKey,
      pageSize: options.pageSize,
      maxPages: options.maxPages,
    });
    return { ...result, priceSource };
  }
  return runTcgcsvSnapshot({
    store: options.store,
    now: options.now,
    force: options.force,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxGroups: options.maxGroups,
  });
}

export function startTrendingSnapshotJob(options: {
  store: SqliteStorePort;
  enabled?: boolean;
  intervalMs?: number;
  now?: () => Date;
  run?: (force?: boolean) => Promise<SnapshotRunResult>;
  onRun?: (result: SnapshotRunResult) => void;
}): { stop: () => void; runOnce: (force?: boolean) => Promise<SnapshotRunResult> } | null {
  const enabled = options.enabled ?? trendingSnapshotEnabledFromEnv();
  if (!enabled) {
    console.log("[TRENDING] Snapshot job disabled (CARD_FLOW_TRENDING_SNAPSHOT_ENABLED / CARD_FLOW_TRENDING_ENABLED)");
    return null;
  }
  const intervalMs = options.intervalMs ?? trendingSnapshotIntervalMsFromEnv();
  const priceSource = trendingPriceSourceFromEnv();
  const run =
    options.run ??
    ((force?: boolean) => runTrendingSnapshot({ store: options.store, now: options.now?.(), force, priceSource }));
  const hasKey = Boolean(pokemonTcgApiKeyFromEnv());
  const sourceNote =
    priceSource === "pokemontcg"
      ? `pokemontcg.io API key ${hasKey ? "set" : "unset"}`
      : "tcgcsv.com (no API key)";
  console.log(
    `[TRENDING] Snapshot job enabled (source ${priceSource}, interval ${intervalMs}ms, ${sourceNote}; cron ${TRENDING_SNAPSHOT_CRON} UTC)`,
  );

  async function runOnce(force = false): Promise<SnapshotRunResult> {
    const result = await run(force);
    options.onRun?.(result);
    if (!result.ok) console.warn(`[TRENDING] Snapshot failed: ${result.error ?? "unknown"}`);
    else if (result.skipped) console.log("[TRENDING] Snapshot skipped (already ran or last-updated unchanged)");
    else {
      console.log(
        `[TRENDING] Snapshot ${result.snapshotDate}: ${result.cardsSeen} cards, ${result.snapshotsWritten} prices, ${result.matched} matched, ${result.unmatched} unmatched`,
      );
    }
    return result;
  }

  void runOnce(false);
  const timer = setInterval(() => {
    void runOnce(false);
  }, intervalMs);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
    },
    runOnce,
  };
}
