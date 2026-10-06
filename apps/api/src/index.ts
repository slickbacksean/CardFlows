import { serve } from "@hono/node-server";
import { loadLocalApiEnv } from "./local-env";
import { createApp } from "./app";
import { createCatalogFromEnv } from "./catalog-env";
import { createPricingFromEnv, createPokecollectorAccountsFromEnv } from "./pokecollector-env";
import { createRecognitionFromEnv } from "./recognition-env";
import { createGradeEstimateFromEnv, gradeEngineProbeFromEnv } from "./grade-estimate-env";
import { createSlabPricingFromEnv } from "./poketrace-env";
import { resolveDevAutoSession } from "./session";
import { createStoreFromEnv } from "./store-env";
import { loadOptionalPhashIndex } from "./obb-phash-provider";
import { resolveLiveIdentityOpenclipFromEnv } from "./live-identity-openclip";

loadLocalApiEnv();

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
  liveIdentifyEnabled: recognitionSelection.identifyEnabled,
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
