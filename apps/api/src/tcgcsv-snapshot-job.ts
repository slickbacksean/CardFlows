/**
 * Daily TCGCSV price snapshot.
 * Walks Pokemon groups one at a time (products + prices) so a small Railway
 * instance never holds the whole catalog. Per-group transactions: a failed
 * group is skipped and does not leave a half-written set. Idempotent per UTC
 * day via ON CONFLICT upserts; force=1 re-runs the same day.
 */
import {
  isEnglishTcgcsvGroupName,
  mapTcgcsvGroupToTcgdexSet,
  mapTcgcsvProductToTcgdex,
  tcgcsvFinishesFromPrices,
  utcDateString,
} from "@cardflow/shared";
import { pokemonTcgIdMap, pokemonTcgPriceSnapshots } from "./db/schema";
import {
  fetchTcgcsvGroups,
  fetchTcgcsvLastUpdated,
  fetchTcgcsvPrices,
  fetchTcgcsvProducts,
  fetchTcgcsvWithRetry,
  sleepMs,
  tcgcsvRequestDelayMsFromEnv,
  tcgcsvUserAgentFromEnv,
  type FetchTcgcsvOptions,
} from "./tcgcsv-http";
import {
  emptySnapshotResult,
  insertRunningSnapshot,
  latestSuccessfulRun,
  pruneOldPriceSnapshots,
  skipIfAlreadyRan,
  writeSnapshotRun,
  type SnapshotRunResult,
} from "./trending-snapshot-run";
import type { SqliteStorePort } from "./sqlite-store";

export interface RunTcgcsvSnapshotOptions {
  store: SqliteStorePort;
  now?: Date;
  force?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
  delayMs?: number;
  maxGroups?: number;
}

export async function runTcgcsvSnapshot(options: RunTcgcsvSnapshotOptions): Promise<SnapshotRunResult> {
  const now = options.now ?? new Date();
  const snapshotDate = utcDateString(now);
  const runId = crypto.randomUUID();
  const startedAt = now.toISOString();
  const skipped = skipIfAlreadyRan(options.store, now, options.force, runId);
  if (skipped) return { ...skipped, priceSource: "tcgcsv" };

  insertRunningSnapshot(options.store, runId, startedAt, snapshotDate);

  const fetchOpts: FetchTcgcsvOptions = {
    fetchImpl: options.fetchImpl,
    userAgent: options.userAgent ?? tcgcsvUserAgentFromEnv(),
  };
  const sleep = options.sleep ?? sleepMs;
  const delayMs = options.delayMs ?? tcgcsvRequestDelayMsFromEnv();

  let pagesFetched = 0;
  let cardsSeen = 0;
  let snapshotsWritten = 0;
  let matched = 0;
  let unmatched = 0;
  const updatedAt = now.toISOString();
  const failedGroups: string[] = [];

  try {
    const lastUpdated = await fetchTcgcsvWithRetry(() => fetchTcgcsvLastUpdated(fetchOpts), { sleep });
    const last = latestSuccessfulRun(options.store);
    if (!options.force && last?.maxTcgplayerUpdatedAt && last.maxTcgplayerUpdatedAt === lastUpdated) {
      const result = emptySnapshotResult(runId, snapshotDate, {
        status: "skipped",
        skipped: true,
        maxTcgplayerUpdatedAt: lastUpdated,
        priceSource: "tcgcsv",
      });
      writeSnapshotRun(options.store, runId, result, startedAt);
      return result;
    }

    await sleep(delayMs);
    const groups = await fetchTcgcsvWithRetry(() => fetchTcgcsvGroups(fetchOpts), { sleep });
    pagesFetched += 1;

    const limited = (options.maxGroups != null ? groups.slice(0, options.maxGroups) : groups).filter(
      (group) => isEnglishTcgcsvGroupName(group.name) && Boolean(mapTcgcsvGroupToTcgdexSet(group).tcgdexSetId),
    );
    for (const group of limited) {
      try {
        await sleep(delayMs);
        const products = await fetchTcgcsvWithRetry(() => fetchTcgcsvProducts(group.groupId, fetchOpts), { sleep });
        pagesFetched += 1;
        await sleep(delayMs);
        const prices = await fetchTcgcsvWithRetry(() => fetchTcgcsvPrices(group.groupId, fetchOpts), { sleep });
        pagesFetched += 1;

        const pageMatched = { matched: 0, unmatched: 0, snapshots: 0, cards: 0 };
        options.store.db.transaction((tx) => {
          for (const product of products) {
            pageMatched.cards += 1;
            const mapped = mapTcgcsvProductToTcgdex(product, group);
            if (mapped.status === "matched") pageMatched.matched += 1;
            else pageMatched.unmatched += 1;
            tx.insert(pokemonTcgIdMap)
              .values({
                pokemontcgCardId: mapped.externalId,
                tcgdexId: mapped.tcgdexId,
                mappingStatus: mapped.status,
                mappingMethod: mapped.method,
                setId: mapped.tcgdexSetId,
                setName: group.name,
                number: mapped.localId ?? null,
                name: product.name ?? null,
                imageUrl: product.imageUrl ?? null,
                unmatchedReason: mapped.unmatchedReason ?? null,
                updatedAt,
              })
              .onConflictDoUpdate({
                target: pokemonTcgIdMap.pokemontcgCardId,
                set: {
                  tcgdexId: mapped.tcgdexId,
                  mappingStatus: mapped.status,
                  mappingMethod: mapped.method,
                  setId: mapped.tcgdexSetId,
                  setName: group.name,
                  number: mapped.localId ?? null,
                  name: product.name ?? null,
                  imageUrl: product.imageUrl ?? null,
                  unmatchedReason: mapped.unmatchedReason ?? null,
                  updatedAt,
                },
              })
              .run();

            if (mapped.status !== "matched") continue;
            for (const finish of tcgcsvFinishesFromPrices(prices, product.productId)) {
              tx.insert(pokemonTcgPriceSnapshots)
                .values({
                  pokemontcgCardId: mapped.externalId,
                  snapshotDate,
                  variant: finish.variant,
                  marketPriceCents: finish.cents,
                  tcgplayerUpdatedAt: lastUpdated,
                })
                .onConflictDoUpdate({
                  target: [
                    pokemonTcgPriceSnapshots.pokemontcgCardId,
                    pokemonTcgPriceSnapshots.snapshotDate,
                    pokemonTcgPriceSnapshots.variant,
                  ],
                  set: {
                    marketPriceCents: finish.cents,
                    tcgplayerUpdatedAt: lastUpdated,
                  },
                })
                .run();
              pageMatched.snapshots += 1;
            }
          }
        });
        cardsSeen += pageMatched.cards;
        matched += pageMatched.matched;
        unmatched += pageMatched.unmatched;
        snapshotsWritten += pageMatched.snapshots;
      } catch (error) {
        const message = error instanceof Error ? error.message : "group failed";
        failedGroups.push(`${group.name} (${message})`);
      }
    }

    pruneOldPriceSnapshots(options.store, now);

    const tooManyFailed = failedGroups.length > 0 && failedGroups.length * 4 >= limited.length;
    const noData = snapshotsWritten === 0 && matched === 0 && limited.length > 0;
    if (noData || tooManyFailed) {
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
        maxTcgplayerUpdatedAt: lastUpdated,
        priceSource: "tcgcsv",
        error: failedGroups.length
          ? `group failures: ${failedGroups.slice(0, 8).join("; ")}`
          : "no matched card prices written",
      };
      writeSnapshotRun(options.store, runId, result, startedAt);
      return result;
    }

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
      maxTcgplayerUpdatedAt: lastUpdated,
      priceSource: "tcgcsv",
      error: failedGroups.length ? `partial: ${failedGroups.slice(0, 8).join("; ")}` : undefined,
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
      maxTcgplayerUpdatedAt: null,
      priceSource: "tcgcsv",
      error: message,
    };
    writeSnapshotRun(options.store, runId, result, startedAt);
    return result;
  }
}
