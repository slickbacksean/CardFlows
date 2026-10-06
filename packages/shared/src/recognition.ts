import { identifyCardMock } from "./mock-recognition";
import { unconfiguredStillIdentifyResult } from "./recognition-flags";
import {
  RECOGNITION_SCENARIOS,
  type CardFlowNormalizedRecognitionResult,
  type RecognitionProviderName,
  type RecognitionScenario,
} from "./types";

export type RecognitionImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface IdentifyCardRequest {
  /** Decoded image bytes. Mock ignores contents; OBB + pHash hashes persisted stills. */
  image: Uint8Array;
  mimeType: RecognitionImageMimeType;
  /** Optional CardSight segment UUID | name | shortname. Mock ignores this. */
  segment?: string;
  /** Client correlation id — not a vendor secret. */
  clientRequestId?: string;
  /** DEV/mock only. Live adapters ignore this. */
  scenario?: RecognitionScenario;
}

export interface CardRecognitionProvider {
  readonly name: RecognitionProviderName;
  identifyCard(req: IdentifyCardRequest): Promise<CardFlowNormalizedRecognitionResult>;
  checkSetIdentifiable?(setId: string): Promise<{ setId: string; isIdentifiable: boolean }>;
}

export function isRecognitionScenario(value: unknown): value is RecognitionScenario {
  return typeof value === "string" && (RECOGNITION_SCENARIOS as string[]).includes(value);
}

export function createMockCardRecognitionProvider(
  options: { defaultScenario?: RecognitionScenario } = {},
): CardRecognitionProvider {
  return {
    name: "mock",
    async identifyCard(req) {
      const scenario =
        req.scenario ?? options.defaultScenario ?? "high-confidence";
      return identifyCardMock(scenario);
    },
  };
}

export const mockCardRecognitionProvider = createMockCardRecognitionProvider();

/** Unconfigured still identify. Never returns a fixture card. */
export function createOffCardRecognitionProvider(): CardRecognitionProvider {
  return {
    name: "off",
    async identifyCard() {
      return unconfiguredStillIdentifyResult();
    },
  };
}
