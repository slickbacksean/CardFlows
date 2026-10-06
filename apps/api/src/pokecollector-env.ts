import {
  TCGDEX_PRICING_IGNORED,
  TCGDEX_SELF_HOSTED,
  offPricingProvider,
  type CardCatalogProvider,
  type CardPricingProvider,
} from "@cardflow/shared";
import { createPokecollectorCatalogProvider } from "./pokecollector-catalog";
import { createPokecollectorPricingProvider } from "./pokecollector-pricing";
import {
  createPokecollectorAccounts,
  offPokecollectorAccounts,
  type PokecollectorAccounts,
} from "./pokecollector-accounts";
import type { PokecollectorHttpOptions } from "./pokecollector-http";

export type PokecollectorKind = "pokecollector" | "off";

export interface PokecollectorSelection {
  kind: PokecollectorKind;
  enabled: boolean;
  baseUrl: string | null;
  selfHosted: false;
  pricingIgnored: true;
  reason: string;
}

type Env = NodeJS.Dict<string | undefined>;

function envValue(env: Env, key: string): string | undefined {
  const value = env[key];
  if (value === undefined || value.trim() === "") return undefined;
  return value.trim();
}

function isTestEnv(env: Env): boolean {
  return env.VITEST === "true" || env.NODE_ENV === "test";
}

function httpOptions(selection: PokecollectorSelection): PokecollectorHttpOptions | null {
  if (!selection.enabled || !selection.baseUrl) return null;
  return {
    baseUrl: selection.baseUrl,
    token: undefined,
  };
}

/**
 * PokéCollector is opt-in via CARD_FLOW_POKECOLLECTOR_URL.
 * CI / `pnpm test` stay on mocks even if a local URL is set.
 * CARD_FLOW_POKECOLLECTOR_ENABLED=false is a kill switch.
 */
export function resolvePokecollectorSelection(env: Env = process.env): PokecollectorSelection {
  const selfHosted = TCGDEX_SELF_HOSTED;
  const pricingIgnored = TCGDEX_PRICING_IGNORED;
  const enabledFlag = envValue(env, "CARD_FLOW_POKECOLLECTOR_ENABLED")?.toLowerCase();
  const baseUrl = envValue(env, "CARD_FLOW_POKECOLLECTOR_URL") ?? null;

  const off = (reason: string): PokecollectorSelection => ({
    kind: "off",
    enabled: false,
    baseUrl,
    selfHosted,
    pricingIgnored,
    reason,
  });

  if (enabledFlag === "false") {
    return off("pokecollector_enabled=false");
  }

  if (isTestEnv(env) && enabledFlag !== "true") {
    return off("test without live PokéCollector");
  }

  if (!baseUrl) {
    return off("CARD_FLOW_POKECOLLECTOR_URL unset");
  }

  return {
    kind: "pokecollector",
    enabled: true,
    baseUrl,
    selfHosted,
    pricingIgnored,
    reason:
      enabledFlag === "true"
        ? "CARD_FLOW_POKECOLLECTOR_ENABLED=true"
        : "CARD_FLOW_POKECOLLECTOR_URL set",
  };
}

export function pokecollectorHttpFromEnv(
  env: Env = process.env,
): PokecollectorHttpOptions | null {
  const selection = resolvePokecollectorSelection(env);
  const options = httpOptions(selection);
  if (!options) return null;
  return {
    ...options,
    token: envValue(env, "CARD_FLOW_POKECOLLECTOR_TOKEN") ?? null,
  };
}

export function createPokecollectorCatalogFromEnv(
  env: Env = process.env,
): CardCatalogProvider | null {
  const options = pokecollectorHttpFromEnv(env);
  if (!options) return null;
  return createPokecollectorCatalogProvider(options);
}

export function createPricingFromEnv(env: Env = process.env): {
  pricing: CardPricingProvider;
  selection: PokecollectorSelection;
} {
  const selection = resolvePokecollectorSelection(env);
  const options = pokecollectorHttpFromEnv(env);
  if (!options) {
    return { pricing: offPricingProvider, selection };
  }
  return { pricing: createPokecollectorPricingProvider(options), selection };
}

export function createPokecollectorAccountsFromEnv(env: Env = process.env): {
  accounts: PokecollectorAccounts;
  selection: PokecollectorSelection;
} {
  const selection = resolvePokecollectorSelection(env);
  const options = pokecollectorHttpFromEnv(env);
  if (!options) {
    return { accounts: offPokecollectorAccounts, selection };
  }
  return { accounts: createPokecollectorAccounts(options), selection };
}
