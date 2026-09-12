import type {
  CardFlowNormalizedRecognitionResult,
  CardRecognitionProvider,
  IdentifyCardRequest,
} from '@cardflows/shared';
import { cardsightFixtures } from '../fixtures.js';

export type CardSightMockScenario =
  | 'high-confidence'
  | 'ambiguous'
  | 'no-card'
  | 'error'
  | 'rate-limit';

function resolveScenario(): CardSightMockScenario {
  const value = process.env.CARDSIGHT_MOCK_SCENARIO ?? 'high-confidence';
  if (
    value === 'high-confidence' ||
    value === 'ambiguous' ||
    value === 'no-card' ||
    value === 'error' ||
    value === 'rate-limit'
  ) {
    return value;
  }
  return 'high-confidence';
}

export class MockCardRecognitionProvider implements CardRecognitionProvider {
  readonly name = 'mock' as const;

  constructor(private readonly scenarioOverride?: CardSightMockScenario) {}

  async identifyCard(_req: IdentifyCardRequest): Promise<CardFlowNormalizedRecognitionResult> {
    const scenario = this.scenarioOverride ?? resolveScenario();

    switch (scenario) {
      case 'high-confidence':
        return cardsightFixtures.highConfidence();
      case 'ambiguous':
        return cardsightFixtures.ambiguous();
      case 'no-card':
        return cardsightFixtures.noCard();
      case 'error':
        return cardsightFixtures.providerError();
      case 'rate-limit':
        return cardsightFixtures.rateLimit();
      default:
        return cardsightFixtures.highConfidence();
    }
  }
}
