import {
  createDisabledTcgdexCatalogProvider,
  mockTcgdexCatalogProvider,
  TCGDEX_PRICING_IGNORED,
  TCGDEX_SELF_HOSTED,
  type CardCatalogProvider,
} from "@cardflow/shared";
import { createTcgdexCatalogProvider } from "./tcgdex-catalog";
import { createPokecollectorCatalogFromEnv, resolvePokecollectorSelection } from "./pokecollector-env";

export type CatalogKind = "mock" | "tcgdex" | "disabled" | "pokecollector";

export interface CatalogSelection {
  kind: CatalogKind;
  enabled: boolean;
  selfHosted: false;
  pricingIgnored: true;
  reason: string;
}

type Env = NodeJS.Dict<string | undefined>;

function envValue(env: Env, key: string): string | undefined {
  const value = env[key];
  if (value === undefined || value.trim() === "") return undefined;
  return value.trim().toLowerCase();
}

function isTestEnv(env: Env): boolean {
  return env.VITEST === "true" || env.NODE_ENV === "test";
}

/**
 * `tcgdex_catalog_enabled`: on in local/staging when network is allowed.
 * CI/tests stay on mock unless explicitly opted into live.
 * Kill switch (flag off outside tests) → FEATURE_DISABLED.
 */
export function resolveCatalogSelection(env: Env = process.env): CatalogSelection {
  const selfHosted = TCGDEX_SELF_HOSTED;
  const pricingIgnored = TCGDEX_PRICING_IGNORED;
  const pokecollector = resolvePokecollectorSelection(env);
  if (pokecollector.enabled) {
    return {
      kind: "pokecollector",
      enabled: true,
      selfHosted,
      pricingIgnored,
      reason: pokecollector.reason,
    };
  }
  const raw = envValue(env, "CARD_FLOW_TCGDEX_CATALOG_ENABLED");

  if (raw === "true") {
    return {
      kind: "tcgdex",
      enabled: true,
      selfHosted,
      pricingIgnored,
      reason: "CARD_FLOW_TCGDEX_CATALOG_ENABLED=true",
    };
  }

  if (raw === "false") {
    if (isTestEnv(env)) {
      return {
        kind: "mock",
        enabled: false,
        selfHosted,
        pricingIgnored,
        reason: "test with tcgdex_catalog_enabled off",
      };
    }
    return {
      kind: "disabled",
      enabled: false,
      selfHosted,
      pricingIgnored,
      reason: "tcgdex_catalog_enabled=false",
    };
  }

  if (isTestEnv(env)) {
    return {
      kind: "mock",
      enabled: false,
      selfHosted,
      pricingIgnored,
      reason: "test without live catalog",
    };
  }

  return {
    kind: "tcgdex",
    enabled: true,
    selfHosted,
    pricingIgnored,
    reason: "local/staging network allowed",
  };
}

export function createCatalogFromEnv(env: Env = process.env): {
  catalog: CardCatalogProvider;
  selection: CatalogSelection;
} {
  const selection = resolveCatalogSelection(env);
  if (selection.kind === "pokecollector") {
    const catalog = createPokecollectorCatalogFromEnv(env);
    if (catalog) return { catalog, selection };
  }
  if (selection.kind === "mock") {
    return { catalog: mockTcgdexCatalogProvider, selection };
  }
  if (selection.kind === "disabled") {
    return { catalog: createDisabledTcgdexCatalogProvider(), selection };
  }
  return { catalog: createTcgdexCatalogProvider(), selection };
}
