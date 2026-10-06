import type { CardFlowNormalizedMappingResult, CardIdentityMapper, SelectedVariant } from '@cardflows/shared';
import { tcgdexFixtures } from '../fixtures.js';

export type MapperMockScenario = 'high-map' | 'no-match' | 'ambiguous';

function resolveScenario(): MapperMockScenario {
  const value = process.env.TCGDEX_MOCK_SCENARIO ?? 'high-map';
  if (value === 'high-map' || value === 'no-match' || value === 'ambiguous') {
    return value;
  }
  return 'high-map';
}

/**
 * Mock mapper: returns fixture mapping results. Never looks up TCGdex with a CardSight id.
 * Auto-map requires language + set + localId + name; name-only never produces matched status.
 */
export class MockCardIdentityMapper implements CardIdentityMapper {
  constructor(private readonly scenarioOverride?: MapperMockScenario) {}

  async mapRecognitionToCatalog(input: {
    language: string | null;
    setName: string | null;
    number: string | null;
    name: string | null;
    vendorCardId: string | null;
    variantHint?: SelectedVariant | null;
  }): Promise<CardFlowNormalizedMappingResult> {
    const scenario = this.scenarioOverride ?? resolveScenario();

    if (scenario === 'no-match') {
      const result = tcgdexFixtures.noMatch();
      return {
        ...result,
        cardsightCardId: input.vendorCardId,
      };
    }

    if (scenario === 'ambiguous') {
      return tcgdexFixtures.ambiguous();
    }

    const hasFullKeys =
      Boolean(input.language) &&
      Boolean(input.setName) &&
      Boolean(input.number) &&
      Boolean(input.name);

    if (!hasFullKeys) {
      if (input.name && !input.setName && !input.number) {
        return tcgdexFixtures.ambiguous();
      }
      const noMatch = tcgdexFixtures.noMatch();
      return {
        ...noMatch,
        cardsightCardId: input.vendorCardId,
      };
    }

    const highMap = tcgdexFixtures.highMap();
    return {
      ...highMap,
      cardsightCardId: input.vendorCardId ?? highMap.cardsightCardId,
    };
  }
}
