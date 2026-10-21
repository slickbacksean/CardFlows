import path from "node:path";
import { serve } from "@hono/node-server";
import { loadLocalApiEnv } from "./local-env";
import { captureApiException, initApiSentry } from "./sentry";
import { createApp, litestreamModeFromEnv } from "./app";
import { createCatalogFromEnv } from "./catalog-env";
import { createPricingFromEnv, createPokecollectorAccountsFromEnv } from "./pokecollector-env";
import { createRecognitionFromEnv } from "./recognition-env";
import { cardSightAdapterFromEnv } from "./cardsight-adapter";
import { cardMagicFromEnv } from "./cardmagic-adapter";
import { calendarMonthKey } from "@cardflow/shared";
import { consumeCardSightBudget } from "./cardsight-budget";
import { cardMagicIdReserveFromEnv, cardSightMonthlyBudgetFromEnv, cardSightUserCapsFromEnv } from "./grade-quota-env";
import { createGradeEstimateFromEnv, gradeEngineProbeFromEnv } from "./grade-estimate-env";
import { createSlabPricingFromEnv } from "./poketrace-env";
import { resolveDevAutoSession } from "./session";
import { installUnmappedSetNameLogger } from "./tcgdex-catalog";
import { scanPhotoTtlHoursFromEnv, startPhotoRetentionJob } from "./photo-retention";
import { startDiskUsageMonitor } from "./disk-usage";
import { purgeExpiredGradeExtras } from "./grade-extra-store";
import { createStoreFromEnv } from "./store-env";
import { createFsTrainingStore, trainingCaptureConfigFromEnv } from "./training-store";
import { loadOptionalPhashIndex } from "./obb-phash-provider";
import { resolveLiveIdentityOpenclipFromEnv } from "./live-identity-openclip";
import { resolveLiveVideoObbDetector } from "./live-video-obb";
import type { ObbDetector } from "@cardflow/shared";
import { opsMetrics, webhookAlertSink } from "./ops-metrics";
import { assertProductionConfig } from "./production-config";

installUnmappedSetNameLogger();

loadLocalApiEnv();
assertProductionConfig();
initApiSentry();

// P1-17 alerts: always logged; sent to Sentry when SENTRY_DSN is set and to a webhook when configured.
opsMetrics.addSink((alert) => console.warn(JSON.stringify({ event: "ops_alert", ...alert })));
opsMetrics.addSink((alert) => captureApiException(new Error(`[ops_alert] ${alert.message}`)));
const alertWebhook = process.env.CARD_FLOW_ALERT_WEBHOOK_URL?.trim();
if (alertWebhook) opsMetrics.addSink(webhookAlertSink(alertWebhook));

const parsedPort = Number(process.env.PORT);
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3001;
const { store, selection } = createStoreFromEnv();
const { catalog, selection: catalogSelection } = createCatalogFromEnv();
const { pricing, selection: pricingSelection } = createPricingFromEnv();
const { accounts: pokecollectorAccounts, selection: accountsSelection } =
  createPokecollectorAccountsFromEnv();
const { recognition, selection: recognitionSelection } = createRecognitionFromEnv();
const { grading, cardgrading, gradeGate, selection: gradeEstimateSelection } = createGradeEstimateFromEnv();
const gradeEngineProbe = gradeEngineProbeFromEnv(cardgrading);
const { slabPricing, selection: slabPricingSelection } = createSlabPricingFromEnv();
const { client: liveIdentityOpenclip, reason: openclipReason } =
  resolveLiveIdentityOpenclipFromEnv();
// Sean: CardSight only with CARD_FLOW_CARDSIGHT_ADAPTER=on + CARDSIGHT_API_KEY, and the app calls
// it only for users who allowed it (current consent version); everyone else gets the local matcher.
const cardSightBudget = cardSightMonthlyBudgetFromEnv();
const cardMagicIdReserve = cardMagicIdReserveFromEnv(process.env, cardSightBudget);
const cardSight = cardSightAdapterFromEnv(process.env, {
  // Peek before the call; charge only after a successful billable response.
  budgetAvailable: () => {
    if (cardSightBudget == null) return true;
    return store.getVendorQuotaUsage("cardsight", calendarMonthKey(new Date())) < cardSightBudget;
  },
  consumeBudget: () =>
    consumeCardSightBudget({
      consume: store.consumeVendorQuota,
      getUsage: store.getVendorQuotaUsage,
      cap: cardSightBudget,
      now: new Date(),
      onUsage: (used, cap) => opsMetrics.recordCardSightBudgetUsage(used, cap),
    }),
});
const cardMagic = cardMagicFromEnv(process.env, {
  // Same global monthly budget as identify (one CardSight plan).
  // ID reserve + per-call takeUse are applied in the grade detect route.
});
// Sean (Oct 21): confirmed Scan a Card photos kept to train PokeSniper's own matcher (Terms §5).
// TODO(R2): restricted bucket. Until then the data volume; production keeps it off unless
// CARD_FLOW_TRAINING_CAPTURE_ENABLED=true. The opt-out store exists whenever a directory does,
// so Settings opt-outs and deletions always work.
const trainingConfig = trainingCaptureConfigFromEnv(process.env, selection.kind === "sqlite" ? selection.sqlitePath : null);
const trainingStore = trainingConfig.dir ? createFsTrainingStore(trainingConfig.dir) : null;
const liveVideoYoloHolder: { detector: ObbDetector | null } = { detector: null };
const app = createApp(store, {
  devAutoSession: resolveDevAutoSession(),
  catalog,
  pricing,
  pokecollectorAccounts,
  recognition,
  cardSight,
  cardMagic,
  cardSightUserCaps: cardSightUserCapsFromEnv(),
  cardSightMonthlyBudget: cardSightBudget,
  cardMagicIdReserve,
  grading,
  cardgrading,
  gradeEngineProbe,
  gradeGate,
  slabPricing,
  livestreamIdentify: "yolo_identity",
  livestreamIdentityIndex: loadOptionalPhashIndex(),
  liveIdentityOpenclip,
  liveVideoObb: () => liveVideoYoloHolder.detector,
  liveIdentifyEnabled: recognitionSelection.identifyEnabled,
  trainingCapture: trainingStore
    ? { store: trainingStore, enabled: trainingConfig.enabled, retentionMonths: trainingConfig.retentionMonths }
    : undefined,
});
// Sean (Oct 19): photos are deleted right after identification / grading. This hourly sweep
// catches anything left by failed or abandoned work: grade stills and extras after 24 h, scan
// stills after CARD_FLOW_SCAN_PHOTO_TTL_HOURS (24). Image files only; rows and MyDEX stay.
const scanPhotoTtlHours = scanPhotoTtlHoursFromEnv();
const photoRetention = startPhotoRetentionJob({
  purge: (now) => {
    const graded = store.purgeExpiredGradePhotos(now);
    const extras = purgeExpiredGradeExtras(now);
    const scans = store.purgeExpiredScanPhotos(now, scanPhotoTtlHours);
    // Training photos: deleted after CARD_FLOW_TRAINING_RETENTION_MONTHS (default 12).
    const training = trainingStore?.purgeExpired(now, trainingConfig.retentionMonths) ?? 0;
    return { deleted: graded.deleted + extras.deleted + scans.deleted + training };
  },
  onPurge: (result) => {
    if (result.deleted > 0) {
      console.log(`Photo retention: swept ${result.deleted} leftover photo(s) older than 24 h`);
    }
  },
});
// Low-disk alert at 70% / 85% of the data volume (same alert sinks as P1-17).
const diskMonitor =
  selection.kind === "sqlite"
    ? startDiskUsageMonitor({ dir: path.dirname(selection.sqlitePath), metrics: opsMetrics })
    : null;

void resolveLiveVideoObbDetector().then((detector) => {
  liveVideoYoloHolder.detector = detector;
  console.log(
    `Live video YOLO: ${detector ? "on" : "off"} (${detector ? "AGPL accepted, weights loaded" : "needs CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true and CARD_FLOW_OBB_ONNX_PATH"})`,
  );
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`CardFlow API listening on http://localhost:${info.port}`);
  console.log(`Backups: litestream ${litestreamModeFromEnv()}`);
  if (selection.kind === "sqlite") {
    console.log(`Store: sqlite (${selection.sqlitePath})`);
  } else {
    console.log(`Store: memory (${selection.reason})`);
  }
  console.log(`Catalog: ${catalogSelection.kind} (${catalogSelection.reason})`);
  console.log(
    `Recognition: ${recognitionSelection.kind} (${recognitionSelection.reason})`,
  );
  console.log(`Training capture: ${trainingConfig.enabled ? "on" : "off"} (${trainingConfig.reason})`);
  console.log(`Grade estimate: ${gradeEstimateSelection.kind} (${gradeEstimateSelection.reason})`);
  console.log(`Slab pricing: ${slabPricingSelection.kind} (${slabPricingSelection.reason})`);
  console.log(`Pricing: ${pricingSelection.kind} (${pricingSelection.reason})`);
  console.log(`PokéCollector accounts: ${accountsSelection.kind} (${accountsSelection.reason})`);
  console.log(
    `Live identity OpenCLIP: ${liveIdentityOpenclip ? "on" : "off"} (${openclipReason})`,
  );
  if (resolveDevAutoSession()) {
    console.warn(
      "Dev auto-session is on. Requests without a token act as the default tester. Set CARD_FLOW_DEV_AUTO_SESSION=false outside local dev.",
    );
  }
});

// Railway redeploys send SIGTERM (30 s drain). Stop taking requests, give in-flight work up
// to 10 s, then close SQLite (checkpoints the WAL) so Litestream's final sync sees it all.
// In-memory grade jobs are lost; the app treats a missing job as "retry".
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  const startedAt = Date.now();
  photoRetention.stop();
  diskMonitor?.stop();
  const finish = () => {
    try {
      (store as { close?: () => void }).close?.();
    } catch (error) {
      console.error("Store close failed", error);
    }
    console.log(JSON.stringify({ event: "shutdown", signal, ms: Date.now() - startedAt }));
    process.exit(0);
  };
  const force = setTimeout(finish, 10_000);
  force.unref();
  server.close(() => {
    clearTimeout(force);
    finish();
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
