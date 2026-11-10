/**
 * Daily pokemontcg.io price snapshot (fallback when CARD_FLOW_TRENDING_PRICE_SOURCE=pokemontcg).
 * Writes market cents per finish into pokemon_tcg_price_snapshots and maps ids to TCGdex.
 * Respects rate limits; never prints POKEMONTCG_API_KEY.
 */
import { mapPokemontcgCardToTcgdex, utcDateString } from "@cardflow/shared";
import { pokemonTcgIdMap, pokemonTcgPriceSnapshots } from "./db/schema";
import {
  fetchPokemonTcgPageWithRetry,
  marketUsdToCents,
  pokemonTcgApiKeyFromEnv,
  pokemonTcgRequestDelayMs,
  sleepMs,
  type PokemonTcgCard,
} from "./pokemon-tcg-http";
import type { SqliteStorePort } from "./sqlite-store";
import {
  TRENDING_SNAPSHOT_CRON,
  insertRunningSnapshot,
  pruneOldPriceSnapshots,
  skipIfAlreadyRan,
  trendingSnapshotEnabledFromEnv,
  trendingSnapshotIntervalMsFromEnv,
  writeSnapshotRun,
  type SnapshotRunResult,
} from "./trending-snapshot-run";

export {
  TRENDING_SNAPSHOT_CRON,
  TRENDING_SNAPSHOT_INTERVAL_MS,
  TRENDING_SNAPSHOT_MIN_GAP_MS,
  TRENDING_SNAPSHOT_RETENTION_DAYS,
  trendingSnapshotEnabledFromEnv,
  trendingSnapshotIntervalMsFromEnv,
} from "./trending-snapshot-run";
export type { SnapshotRunResult } from "./trending-snapshot-run";

export interface RunSnapshotOptions {
  store: SqliteStorePort;
  now?: Date;
  force?: boolean;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pageSize?: number;
  maxPages?: number;
}

function finishesFromCard(card: PokemonTcgCard): Array<{ variant: string; cents: number }> {
  const prices = card.tcgplayer?.prices;
  if (!prices) return [];
  const out: Array<{ variant: string; cents: number }> = [];
  for (const [variant, finish] of Object.entries(prices)) {
    const cents = marketUsdToCents(finish?.market);
    if (cents == null) continue;
    out.push({ variant, cents });
  }
  return out;
}

export async function runPokemonTcgSnapshot(options: RunSnapshotOptions): Promise<SnapshotRunResult> {
  const now = options.now ?? new Date();
  const snapshotDate = utcDateString(now);
  const runId = crypto.randomUUID();
  const startedAt = now.toISOString();
  const apiKey = options.apiKey !== undefined ? options.apiKey : pokemonTcgApiKeyFromEnv();
  const sleep = options.sleep ?? sleepMs;
  const delayMs = pokemonTcgRequestDelayMs(Boolean(apiKey));

  const skipped = skipIfAlreadyRan(options.store, now, options.force, runId);
  if (skipped) return skipped;

  insertRunningSnapshot(options.store, runId, startedAt, snapshotDate);

  let pagesFetched = 0;
  let cardsSeen = 0;
  let snapshotsWritten = 0;
  let matched = 0;
  let unmatched = 0;
  let maxTcgplayerUpdatedAt: string | null = null;
  const updatedAt = now.toISOString();

  try {
    let page = 1;
    while (true) {
      if (options.maxPages != null && page > options.maxPages) break;
      const payload = await fetchPokemonTcgPageWithRetry({
        page,
        pageSize: options.pageSize,
        apiKey,
        fetchImpl: options.fetchImpl,
        sleep,
      });
      pagesFetched += 1;
      if (payload.data.length === 0) break;

      const pageCards = payload.data;
      const pageMatched: {
        matched: number;
        unmatched: number;
        snapshots: number;
        maxUpdated: string | null;
      } = { matched: 0, unmatched: 0, snapshots: 0, maxUpdated: maxTcgplayerUpdatedAt };
      options.store.db.transaction((tx) => {
        for (const card of pageCards) {
          const mapped = mapPokemontcgCardToTcgdex({
            id: card.id,
            number: card.number,
            setId: card.set?.id,
            setName: card.set?.name,
          });
          if (mapped.status === "matched") pageMatched.matched += 1;
          else pageMatched.unmatched += 1;
          tx.insert(pokemonTcgIdMap)
            .values({
              pokemontcgCardId: mapped.pokemontcgCardId,
              tcgdexId: mapped.tcgdexId,
              mappingStatus: mapped.status,
              mappingMethod: mapped.method,
              setId: card.set?.id ?? mapped.tcgdexSetId,
              setName: card.set?.name ?? null,
              number: card.number ?? mapped.localId,
              name: card.name ?? null,
              imageUrl: card.images?.small ?? card.images?.large ?? null,
              unmatchedReason: mapped.unmatchedReason ?? null,
              updatedAt,
            })
            .onConflictDoUpdate({
              target: pokemonTcgIdMap.pokemontcgCardId,
              set: {
                tcgdexId: mapped.tcgdexId,
                mappingStatus: mapped.status,
                mappingMethod: mapped.method,
                setId: card.set?.id ?? mapped.tcgdexSetId,
                setName: card.set?.name ?? null,
                number: card.number ?? mapped.localId,
                name: card.name ?? null,
                imageUrl: card.images?.small ?? card.images?.large ?? null,
                unmatchedReason: mapped.unmatchedReason ?? null,
                updatedAt,
              },
            })
            .run();

          const updated = card.tcgplayer?.updatedAt;
          if (updated && (!pageMatched.maxUpdated || updated > pageMatched.maxUpdated)) {
            pageMatched.maxUpdated = updated;
          }
          for (const finish of finishesFromCard(card)) {
            tx.insert(pokemonTcgPriceSnapshots)
              .values({
                pokemontcgCardId: card.id,
                snapshotDate,
                variant: finish.variant,
                marketPriceCents: finish.cents,
                tcgplayerUpdatedAt: updated ?? null,
              })
              .onConflictDoUpdate({
                target: [
                  pokemonTcgPriceSnapshots.pokemontcgCardId,
                  pokemonTcgPriceSnapshots.snapshotDate,
                  pokemonTcgPriceSnapshots.variant,
                ],
                set: {
                  marketPriceCents: finish.cents,
                  tcgplayerUpdatedAt: updated ?? null,
                },
              })
              .run();
            pageMatched.snapshots += 1;
          }
        }
      });
      cardsSeen += pageCards.length;
      matched += pageMatched.matched;
      unmatched += pageMatched.unmatched;
      snapshotsWritten += pageMatched.snapshots;
      maxTcgplayerUpdatedAt = pageMatched.maxUpdated;

      if (payload.data.length < (options.pageSize ?? payload.pageSize) || page * payload.pageSize >= payload.totalCount) {
        break;
      }
      page += 1;
      await sleep(delayMs);
    }

    pruneOldPriceSnapshots(options.store, now);

    const result: SnapshotRunResult = {
      ok: true,
      status: "success",
      runId,
      snapshotDate,
      pagesFetched,
      cardsSeen,
      snapshotsWritten,
      matched,
      unmatched,
      maxTcgplayerUpdatedAt,
    };
    writeSnapshotRun(options.store, runId, result, startedAt);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "snapshot failed";
    const result: SnapshotRunResult = {
      ok: false,
      status: "failed",
      runId,
      snapshotDate,
      pagesFetched,
      cardsSeen,
      snapshotsWritten,
      matched,
      unmatched,
      maxTcgplayerUpdatedAt,
      error: message,
    };
    writeSnapshotRun(options.store, runId, result, startedAt);
    return result;
  }
}

export function startPokemonTcgSnapshotJob(options: {
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
  const run =
    options.run ??
    ((force?: boolean) => runPokemonTcgSnapshot({ store: options.store, now: options.now?.(), force }));
  const hasKey = Boolean(pokemonTcgApiKeyFromEnv());
  console.log(
    `[TRENDING] Snapshot job enabled (interval ${intervalMs}ms, pokemontcg.io API key ${hasKey ? "set" : "unset"}; cron ${TRENDING_SNAPSHOT_CRON} UTC)`,
  );

  async function runOnce(force = false): Promise<SnapshotRunResult> {
    const result = await run(force);
    options.onRun?.(result);
    if (!result.ok) console.warn(`[TRENDING] Snapshot failed: ${result.error ?? "unknown"}`);
    else if (result.skipped) console.log("[TRENDING] Snapshot skipped (already ran)");
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
