/**
 * Daily pokemontcg.io price snapshot.
 * Writes market cents per finish into pokemon_tcg_price_snapshots and maps ids to TCGdex.
 * Respects rate limits; never prints POKEMONTCG_API_KEY.
 */
import { desc, eq, lt } from "drizzle-orm";
import { mapPokemontcgCardToTcgdex, utcDateString } from "@cardflow/shared";
import {
  pokemonTcgIdMap,
  pokemonTcgPriceSnapshots,
  pokemonTcgSnapshotRuns,
} from "./db/schema";
import {
  fetchPokemonTcgPageWithRetry,
  marketUsdToCents,
  pokemonTcgApiKeyFromEnv,
  pokemonTcgRequestDelayMs,
  sleepMs,
  type PokemonTcgCard,
} from "./pokemon-tcg-http";
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
}

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

function latestSuccessfulRun(store: SqliteStorePort): { snapshotDate: string; finishedAt: string } | null {
  const row = store.db
    .select({
      snapshotDate: pokemonTcgSnapshotRuns.snapshotDate,
      finishedAt: pokemonTcgSnapshotRuns.finishedAt,
    })
    .from(pokemonTcgSnapshotRuns)
    .where(eq(pokemonTcgSnapshotRuns.status, "success"))
    .orderBy(desc(pokemonTcgSnapshotRuns.finishedAt))
    .limit(1)
    .all()[0];
  if (!row?.snapshotDate || !row.finishedAt) return null;
  return { snapshotDate: row.snapshotDate, finishedAt: row.finishedAt };
}

function writeRun(store: SqliteStorePort, runId: string, result: SnapshotRunResult, startedAt?: string): void {
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

export async function runPokemonTcgSnapshot(options: RunSnapshotOptions): Promise<SnapshotRunResult> {
  const now = options.now ?? new Date();
  const snapshotDate = utcDateString(now);
  const runId = crypto.randomUUID();
  const startedAt = now.toISOString();
  const apiKey = options.apiKey !== undefined ? options.apiKey : pokemonTcgApiKeyFromEnv();
  const sleep = options.sleep ?? sleepMs;
  const delayMs = pokemonTcgRequestDelayMs(Boolean(apiKey));

  if (!options.force) {
    const last = latestSuccessfulRun(options.store);
    if (last?.snapshotDate === snapshotDate) {
      return {
        ok: true,
        status: "skipped",
        runId,
        snapshotDate,
        pagesFetched: 0,
        cardsSeen: 0,
        snapshotsWritten: 0,
        matched: 0,
        unmatched: 0,
        maxTcgplayerUpdatedAt: null,
        skipped: true,
      };
    }
    if (last?.finishedAt) {
      const gap = now.getTime() - Date.parse(last.finishedAt);
      if (Number.isFinite(gap) && gap < TRENDING_SNAPSHOT_MIN_GAP_MS) {
        return {
          ok: true,
          status: "skipped",
          runId,
          snapshotDate: last.snapshotDate,
          pagesFetched: 0,
          cardsSeen: 0,
          snapshotsWritten: 0,
          matched: 0,
          unmatched: 0,
          maxTcgplayerUpdatedAt: null,
          skipped: true,
        };
      }
    }
  }

  options.store.db
    .insert(pokemonTcgSnapshotRuns)
    .values({
      runId,
      startedAt,
      status: "running",
      snapshotDate,
    })
    .run();

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

    const cutoff = utcDateString(new Date(now.getTime() - TRENDING_SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000));
    options.store.db.delete(pokemonTcgPriceSnapshots).where(lt(pokemonTcgPriceSnapshots.snapshotDate, cutoff)).run();

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
    writeRun(options.store, runId, result, startedAt);
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
    writeRun(options.store, runId, result, startedAt);
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
