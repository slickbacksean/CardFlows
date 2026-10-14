import { serve } from "@hono/node-server";
import { loadLocalApiEnv } from "./local-env";
import { initApiSentry } from "./sentry";
import { createApp } from "./app";
import { createCatalogFromEnv } from "./catalog-env";
import { createPricingFromEnv, createPokecollectorAccountsFromEnv } from "./pokecollector-env";
import { createRecognitionFromEnv } from "./recognition-env";
import { createGradeEstimateFromEnv, gradeEngineProbeFromEnv } from "./grade-estimate-env";
import { createSlabPricingFromEnv } from "./poketrace-env";
import { resolveDevAutoSession } from "./session";
import { startPhotoRetentionJob } from "./photo-retention";
import { createStoreFromEnv } from "./store-env";
import { loadOptionalPhashIndex } from "./obb-phash-provider";
import { resolveLiveIdentityOpenclipFromEnv } from "./live-identity-openclip";
import { resolveLiveVideoObbDetector } from "./live-video-obb";
import type { ObbDetector } from "@cardflow/shared";

loadLocalApiEnv();
initApiSentry();

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
const liveVideoYoloHolder: { detector: ObbDetector | null } = { detector: null };
const app = createApp(store, {
  devAutoSession: resolveDevAutoSession(),
  catalog,
  pricing,
  pokecollectorAccounts,
  recognition,
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
  purge: (now) => store.purgeExpiredGradePhotos(now),
  onPurge: (result) => {
    if (result.deleted > 0) {
      console.log(`Photo retention: deleted ${result.deleted} graded photo(s) older than 30 days`);
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
