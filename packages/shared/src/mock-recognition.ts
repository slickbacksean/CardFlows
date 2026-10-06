import ambiguous from "../fixtures/cardsight-ambiguous-match.json" with { type: "json" };
import highConfidence from "../fixtures/cardsight-high-confidence.json" with { type: "json" };
import noCard from "../fixtures/cardsight-no-card-detected.json" with { type: "json" };
import providerError from "../fixtures/cardsight-provider-error.json" with { type: "json" };
import rateLimit from "../fixtures/cardsight-rate-limit.json" with { type: "json" };
import type {
  CardFlowNormalizedRecognitionResult,
  RecognitionScenario,
} from "./types";

const NO_MATCH_RECOGNITION: CardFlowNormalizedRecognitionResult = {
  provider: "mock",
  ok: true,
  vendorRequestId: "req_mock_no_match_004",
  processingTimeMs: 198,
  detections: [
    {
      confidence: "Low",
      matchLevel: "none",
      vendorCardId: "e5f6a7b8-c9d0-4123-89ab-cdef01234567",
      name: "Pikachu",
      setName: "Unknown Promo Binder",
      number: "999",
      language: "en",
      fields: [{ key: "CARD_LANGUAGE", value: "en" }],
      candidates: [],
    },
  ],
  error: null,
  _meta: {
    mocked: true,
    description:
      "Synthetic no-match recognition aligned with tcgdex-no-match-example.json",
  },
};

const FIXTURES: Record<
  Exclude<RecognitionScenario, "no-match">,
  CardFlowNormalizedRecognitionResult
> = {
  "high-confidence": highConfidence as CardFlowNormalizedRecognitionResult,
  ambiguous: ambiguous as CardFlowNormalizedRecognitionResult,
  "no-card": noCard as CardFlowNormalizedRecognitionResult,
  error: providerError as CardFlowNormalizedRecognitionResult,
  "rate-limit": rateLimit as CardFlowNormalizedRecognitionResult,
};

export function identifyCardMock(
  scenario: RecognitionScenario = "high-confidence",
): CardFlowNormalizedRecognitionResult {
  if (scenario === "no-match") return NO_MATCH_RECOGNITION;
  return FIXTURES[scenario] ?? FIXTURES["high-confidence"];
}

export { RECOGNITION_SCENARIOS } from "./types";
