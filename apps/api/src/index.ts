import { serve } from "@hono/node-server";
import { loadLocalApiEnv } from "./local-env";
import { captureApiException, initApiSentry } from "./sentry";
import { createApp } from "./app";
import { createCatalogFromEnv } from "./catalog-env";
import { createPricingFromEnv, createPokecollectorAccountsFromEnv } from "./pokecollector-env";
import { createRecognitionFromEnv } from "./recognition-env";
import { cardSightAdapterFromEnv } from "./cardsight-adapter";
import { consumeCardSightBudget } from "./cardsight-budget";
import { cardSightMonthlyBudgetFromEnv, cardSightUserCapsFromEnv } from "./grade-quota-env";
import { createGradeEstimateFromEnv, gradeEngineProbeFromEnv } from "./grade-estimate-env";
import { createSlabPricingFromEnv } from "./poketrace-env";
import { resolveDevAutoSession } from "./session";
import { installUnmappedSetNameLogger } from "./tcgdex-catalog";
import { startPhotoRetentionJob } from "./photo-retention";
import { purgeExpiredGradeExtras } from "./grade-extra-store";
import { createStoreFromEnv } from "./store-env";
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
const cardSight = cardSightAdapterFromEnv(process.env, {
  consumeBudget: () => consumeCardSightBudget({ consume: store.consumeVendorQuota, cap: cardSightBudget, now: new Date() }),
});
const liveVideoYoloHolder: { detector: ObbDetector | null } = { detector: null };
const app = createApp(store, {
  devAutoSession: resolveDevAutoSession(),
  catalog,
  pricing,
  pokecollectorAccounts,
  recognition,
  cardSight,
  cardSightUserCaps: cardSightUserCapsFromEnv(),
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
});
startPhotoRetentionJob({
  purge: (now) => {
    const graded = store.purgeExpiredGradePhotos(now);
    const extras = purgeExpiredGradeExtras(now);
    return { deleted: graded.deleted + extras.deleted };
  },
  onPurge: (result) => {
    if (result.deleted > 0) {
      console.log(`Photo retention: deleted ${result.deleted} graded photo(s)/extra(s) older than 30 days`);
    }
  },
});

void resolveLiveVideoObbDetector().then((detector) => {
  liveVideoYoloHolder.detector = detector;
  console.log(
    `Live video YOLO: ${detector ? "on" : "off"} (${detector ? "AGPL accepted, weights loaded" : "needs CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED=true and CARD_FLOW_OBB_ONNX_PATH"})`,
  );
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`CardFlow API listening on http://localhost:${info.port}`);
  if (selection.kind === "sqlite") {
    console.log(`Store: sqlite (${selection.sqlitePath})`);
  } else {
    console.log(`Store: memory (${selection.reason})`);
  }
  console.log(`Catalog: ${catalogSelection.kind} (${catalogSelection.reason})`);
  console.log(
    `Recognition: ${recognitionSelection.kind} (${recognitionSelection.reason})`,
  );
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
