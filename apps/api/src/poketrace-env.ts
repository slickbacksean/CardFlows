import {
  createOffSlabPricingProvider,
  type SlabPricingProvider,
  type SlabPricingProviderName,
} from "@cardflow/shared";
import { createPoketraceSlabProvider } from "./poketrace-http";

export type SlabPricingKind = SlabPricingProviderName;

export interface SlabPricingSelection {
  kind: SlabPricingKind;
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

/**
 * Prepare slab comps. CI stays off. Flag on + server-only key uses PokeTrace.
 * Flag off or a missing/bad key fail-soft to empty rows — never mock dollars.
 */
export function resolveSlabPricingSelection(env: Env = process.env): SlabPricingSelection {
  if (isTestEnv(env)) {
    return { kind: "off", reason: "test without poketrace" };
  }
  if (envValue(env, "CARD_FLOW_POKETRACE_ENABLED")?.toLowerCase() !== "true") {
    return { kind: "off", reason: "poketrace_enabled=false" };
  }
  if (envValue(env, "POKETRACE_API_KEY")) {
    return { kind: "poketrace", reason: "CARD_FLOW_POKETRACE_ENABLED=true" };
  }
  return { kind: "off", reason: "poketrace_enabled=true without API key" };
}

export function createSlabPricingFromEnv(env: Env = process.env): {
  slabPricing: SlabPricingProvider;
  selection: SlabPricingSelection;
} {
  const selection = resolveSlabPricingSelection(env);
  if (selection.kind === "poketrace") {
    const apiKey = envValue(env, "POKETRACE_API_KEY");
    if (!apiKey) {
      return {
        slabPricing: createOffSlabPricingProvider(),
        selection: { kind: "off", reason: "poketrace_enabled=true without API key" },
      };
    }
    return {
      slabPricing: createPoketraceSlabProvider({
        apiKey,
        baseUrl: envValue(env, "POKETRACE_API_URL"),
      }),
      selection,
    };
  }
  return { slabPricing: createOffSlabPricingProvider(), selection };
}
