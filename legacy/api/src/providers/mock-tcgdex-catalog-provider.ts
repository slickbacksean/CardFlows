import type {
  CardCatalogProvider,
  CatalogLookupRequest,
  TcgdexCard,
  TcgdexLanguage,
  TcgdexSetBrief,
} from '@cardflows/shared';
import { tcgdexFixtures } from '../fixtures.js';

export type TcgdexMockScenario = 'card' | 'high-map' | 'no-match' | 'ambiguous';

function resolveScenario(): TcgdexMockScenario {
  const value = process.env.TCGDEX_MOCK_SCENARIO ?? 'card';
  if (value === 'card' || value === 'high-map' || value === 'no-match' || value === 'ambiguous') {
    return value;
  }
  return 'card';
}

export class MockTcgdexCatalogProvider implements CardCatalogProvider {
  readonly name = 'mock' as const;

  constructor(private readonly scenarioOverride?: TcgdexMockScenario) {}

  async getCardById(id: string, language: TcgdexLanguage): Promise<TcgdexCard | null> {
    const fixture = tcgdexFixtures.card() as { card: TcgdexCard; language: TcgdexLanguage };
    const card = { ...fixture.card, language: fixture.language ?? language };
    return card.id === id ? card : null;
  }

  async getCardBySetAndLocalId(
    setId: string,
    localId: string,
    language: TcgdexLanguage
  ): Promise<TcgdexCard | null> {
    const mapping = tcgdexFixtures.highMap();
    const canonical = mapping.canonicalCard;
    if (
      canonical &&
      canonical.tcgdexSetId === setId &&
      canonical.localId === localId &&
      canonical.language === language
    ) {
      return this.canonicalToTcgdexCard(canonical);
    }
    return null;
  }

  async resolveSetByName(name: string, _language: TcgdexLanguage): Promise<TcgdexSetBrief[]> {
    const mapping = tcgdexFixtures.highMap();
    const canonical = mapping.canonicalCard;
    if (canonical && name === 'Base Set') {
      return [
        {
          id: canonical.tcgdexSetId,
          name: 'Base Set',
          cardCount: { total: 102, official: 102 },
        },
      ];
    }
    return [];
  }

  async listCards(_req: CatalogLookupRequest): Promise<TcgdexCard[]> {
    const scenario = this.scenarioOverride ?? resolveScenario();
    if (scenario === 'no-match') {
      return [];
    }
    if (scenario === 'ambiguous') {
      const mapping = tcgdexFixtures.ambiguous();
      return mapping.candidates.map((candidate) => this.canonicalToTcgdexCard(candidate));
    }
    const mapping = tcgdexFixtures.highMap();
    if (mapping.canonicalCard) {
      return [this.canonicalToTcgdexCard(mapping.canonicalCard)];
    }
    return [];
  }

  private canonicalToTcgdexCard(
    canonical: import('@cardflows/shared').CardFlowCanonicalCard
  ): TcgdexCard {
    const setBrief: TcgdexSetBrief = canonical.set ?? {
      id: canonical.tcgdexSetId,
      name: 'Base Set',
      cardCount: { total: 102, official: 102 },
    };

    return {
      id: canonical.tcgdexId,
      localId: canonical.localId,
      name: canonical.name,
      image: canonical.image.baseUrl,
      category: canonical.category,
      illustrator: null,
      rarity: canonical.rarity,
      set: setBrief,
      variants: canonical.variants,
      language: canonical.language,
    };
  }
}
