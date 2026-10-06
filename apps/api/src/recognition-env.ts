import {
  CARDSIGHT_LIVE_VIDEO_ENABLED,
  CARDSIGHT_PRICING_ENABLED,
  createMockCardRecognitionProvider,
  createOffCardRecognitionProvider,
  isRecognitionScenario,
  mockCardRecognitionProvider,
  type CardRecognitionProvider,
} from "@cardflow/shared";
import { createApiObbPhashProvider } from "./obb-phash-provider";

export type RecognitionKind = "mock" | "obb_phash" | "off";

export interface RecognitionSelection {
  kind: RecognitionKind;
  identifyEnabled: boolean;
  pricingEnabled: false;
  liveVideoEnabled: false;
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
 * Capture still identify is OBB + pHash, never CardSight.
 * CI/tests stay on mock. `CARD_FLOW_OBB_PHASH_ENABLED=true` uses persisted still bytes.
 */
export function resolveRecognitionSelection(env: Env = process.env): RecognitionSelection {
  const pricingEnabled = CARDSIGHT_PRICING_ENABLED;
  const liveVideoEnabled = CARDSIGHT_LIVE_VIDEO_ENABLED;
  const obbEnabled = envValue(env, "CARD_FLOW_OBB_PHASH_ENABLED")?.toLowerCase() === "true";

  if (isTestEnv(env)) {
    return {
      kind: "mock",
      identifyEnabled: false,
      pricingEnabled,
      liveVideoEnabled,
      reason: "test without live identify",
    };
  }

  if (!obbEnabled) {
    return {
      kind: "off",
      identifyEnabled: false,
      pricingEnabled,
      liveVideoEnabled,
      reason: "obb_phash_enabled=false",
    };
  }

  return {
    kind: "obb_phash",
    identifyEnabled: true,
    pricingEnabled,
    liveVideoEnabled,
    reason: "CARD_FLOW_OBB_PHASH_ENABLED=true",
  };
}

export function createRecognitionFromEnv(env: Env = process.env): {
  recognition: CardRecognitionProvider;
  selection: RecognitionSelection;
} {
  const selection = resolveRecognitionSelection(env);
  if (selection.kind === "obb_phash") {
    return { recognition: createApiObbPhashProvider(env), selection };
  }
  if (selection.kind === "off") {
    return { recognition: createOffCardRecognitionProvider(), selection };
  }
  const defaultScenario = isRecognitionScenario(env.CARDSIGHT_MOCK_SCENARIO)
    ? env.CARDSIGHT_MOCK_SCENARIO
    : undefined;
  return {
    recognition: defaultScenario
      ? createMockCardRecognitionProvider({ defaultScenario })
      : mockCardRecognitionProvider,
    selection,
  };
}
