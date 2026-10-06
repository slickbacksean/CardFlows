import { randomUUID } from 'node:crypto';
import {
  buildCrmScan,
  catalogFingerprint,
  mintCardflowCardId,
  type CardFlowCanonicalCard,
  type CardFlowNormalizedMappingResult,
  type CardFlowNormalizedRecognitionResult,
  type CaptureMethod,
  type ConfirmScanRequest,
  type CrmConfirmation,
  type CrmScan,
  type MatchMethod,
  type PersistedCanonicalCard,
  type SelectedVariant,
  type TcgdexLanguage,
} from '@cardflows/shared';
import type { CardCatalogProvider } from '@cardflows/shared';
import type { CardIdentityMapper } from '@cardflows/shared';
import type { CardRecognitionProvider } from '@cardflows/shared';
import type { CardSightMockScenario } from '../providers/mock-card-recognition-provider.js';
import type { MapperMockScenario } from '../providers/mock-card-identity-mapper.js';
import { LocalDevStore } from '../store/local-dev-store.js';

const DEV_USER_ID = 'dev-user-local';

export interface CreateScanInput {
  image: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  captureMethod: CaptureMethod;
  cardsightScenario?: CardSightMockScenario;
  mapperScenario?: MapperMockScenario;
}

export interface ScanServiceDeps {
  store: LocalDevStore;
  recognitionProvider: CardRecognitionProvider;
  identityMapper: CardIdentityMapper;
  catalogProvider: CardCatalogProvider;
  createRecognitionProvider?: (scenario?: CardSightMockScenario) => CardRecognitionProvider;
  createIdentityMapper?: (scenario?: MapperMockScenario) => CardIdentityMapper;
}

function primaryDetection(result: CardFlowNormalizedRecognitionResult) {
  return result.detections[0] ?? null;
}

function toCanonicalCard(
  cardflowCardId: string,
  source: CardFlowCanonicalCard,
  cardsightCardId: string | null,
  selectedVariant: SelectedVariant | null
): CardFlowCanonicalCard {
  return {
    ...source,
    cardflowCardId,
    cardsightCardId,
    selectedVariant,
    matchedOn: source.matchedOn,
  };
}

function toPersistedCanonical(
  card: CardFlowCanonicalCard,
  matchMethod: MatchMethod,
  mintedAt: string
): PersistedCanonicalCard {
  return {
    cardflowCardId: card.cardflowCardId!,
    language: card.language,
    tcgdexId: card.tcgdexId,
    tcgdexSetId: card.tcgdexSetId,
    localId: card.localId,
    name: card.name,
    category: card.category,
    rarity: card.rarity,
    variants: card.variants,
    image: card.image,
    cardsightCardId: card.cardsightCardId,
    matchMethod,
    mintedAt,
    catalogFingerprint: catalogFingerprint(card.language, card.tcgdexId),
  };
}

export class ScanService {
  constructor(private readonly deps: ScanServiceDeps) {}

  async createScan(input: CreateScanInput): Promise<CrmScan> {
    const recognitionProvider =
      input.cardsightScenario && this.deps.createRecognitionProvider
        ? this.deps.createRecognitionProvider(input.cardsightScenario)
        : this.deps.recognitionProvider;

    const identityMapper =
      input.mapperScenario && this.deps.createIdentityMapper
        ? this.deps.createIdentityMapper(input.mapperScenario)
        : this.deps.identityMapper;

    const recognitionResult = await recognitionProvider.identifyCard({
      image: input.image,
      mimeType: input.mimeType,
    });

    const detection = primaryDetection(recognitionResult);
    let mappingResult: CardFlowNormalizedMappingResult;

    if (!recognitionResult.ok || !detection) {
      mappingResult = {
        provider: 'mock',
        ok: true,
        confidence: 'Unresolved',
        status: 'no_match',
        matchedOn: [],
        cardflowCardId: null,
        tcgdexId: null,
        cardsightCardId: detection?.vendorCardId ?? null,
        canonicalCard: null,
        candidates: [],
        error: null,
        _meta: { mocked: true, description: 'Recognition failed — manual search required' },
      };
    } else {
      mappingResult = await identityMapper.mapRecognitionToCatalog({
        language: detection.language,
        setName: detection.setName,
        number: detection.number,
        name: detection.name,
        vendorCardId: detection.vendorCardId,
      });
    }

    const scan = buildCrmScan({
      scanId: randomUUID(),
      userId: DEV_USER_ID,
      captureMethod: input.captureMethod,
      mimeType: input.mimeType,
      recognitionResult,
      mappingResult,
    });

    return this.deps.store.saveScan(scan);
  }

  getScan(scanId: string): CrmScan | null {
    return this.deps.store.getScan(scanId);
  }

  async searchCatalog(input: {
    setName?: string | null;
    localId?: string | null;
    name?: string | null;
    tcgdexId?: string | null;
    language?: TcgdexLanguage;
  }): Promise<CardFlowCanonicalCard[]> {
    const language = input.language ?? 'en';

    if (input.tcgdexId) {
      const byId = await this.deps.catalogProvider.getCardById(input.tcgdexId, language);
      if (byId) {
        return [this.tcgdexToCanonical(byId, null)];
      }

      const dashIndex = input.tcgdexId.lastIndexOf('-');
      if (dashIndex > 0) {
        const setId = input.tcgdexId.slice(0, dashIndex);
        const localId = input.tcgdexId.slice(dashIndex + 1);
        const bySet = await this.deps.catalogProvider.getCardBySetAndLocalId(
          setId,
          localId,
          language
        );
        if (bySet) {
          return [this.tcgdexToCanonical(bySet, null)];
        }
      }

      return [];
    }

    const hasSetAndNumber = Boolean(input.setName) && Boolean(input.localId);
    if (!hasSetAndNumber) {
      return [];
    }

    const sets = await this.deps.catalogProvider.resolveSetByName(input.setName!, language);
    if (sets.length !== 1) {
      const ambiguous = await this.deps.catalogProvider.listCards({
        language,
        setName: input.setName,
        localId: input.localId,
        name: input.name,
      });
      return ambiguous.map((card, index) => this.tcgdexToCanonical(card, index));
    }

    const card = await this.deps.catalogProvider.getCardBySetAndLocalId(
      sets[0].id,
      input.localId!,
      language
    );
    if (card) {
      return [this.tcgdexToCanonical(card, null)];
    }

    const listed = await this.deps.catalogProvider.listCards({
      language,
      setName: input.setName,
      localId: input.localId,
      name: input.name,
    });
    return listed.map((card, index) => this.tcgdexToCanonical(card, index));
  }

  private tcgdexToCanonical(
    card: import('@cardflows/shared').TcgdexCard,
    rank: number | null
  ): CardFlowCanonicalCard {
    const baseUrl = card.image ?? `https://assets.tcgdex.net/en/base/${card.set.id}/${card.localId}`;
    return {
      cardflowCardId: null,
      language: card.language,
      tcgdexId: card.id,
      tcgdexSetId: card.set.id,
      localId: card.localId,
      name: card.name,
      category: card.category,
      rarity: card.rarity,
      variants: card.variants,
      selectedVariant: null,
      set: card.set,
      image: {
        baseUrl,
        source: 'tcgdex_assets',
        quality: 'low',
        extension: 'webp',
        constructedUrl: `${baseUrl}/low.webp`,
        provenance: `tcgdex assets; card id ${card.id}; lang ${card.language}`,
      },
      cardsightCardId: null,
      rank: rank ?? undefined,
      matchedOn: ['language', 'set', 'localId', 'name'],
    };
  }

  private resolveCandidate(
    scan: CrmScan,
    request: ConfirmScanRequest
  ): CardFlowCanonicalCard | null {
    const fromMapping =
      scan.mappingResult.canonicalCard?.tcgdexId === request.tcgdexId
        ? scan.mappingResult.canonicalCard
        : scan.mappingResult.candidates.find((c) => c.tcgdexId === request.tcgdexId);

    if (fromMapping) {
      return fromMapping;
    }

    return null;
  }

  async confirmScan(scanId: string, request: ConfirmScanRequest): Promise<CrmConfirmation> {
    const scan = this.deps.store.getScan(scanId);
    if (!scan) {
      throw new ScanServiceError('NOT_FOUND', 'Scan not found');
    }
    if (scan.preInventoryState === 'identity_confirmed') {
      throw new ScanServiceError('ALREADY_CONFIRMED', 'Scan already confirmed');
    }

    if (request.matchMethod === 'manual') {
      const hasSetAndNumber = Boolean(request.setName) && Boolean(request.localId);
      if (!hasSetAndNumber) {
        throw new ScanServiceError(
          'VALIDATION',
          'Manual confirm requires set name and card number'
        );
      }
    }

    let candidate = this.resolveCandidate(scan, request);

    if (!candidate && request.matchMethod === 'manual') {
      const searchResults = await this.searchCatalog({
        tcgdexId: request.tcgdexId,
        setName: request.setName,
        localId: request.localId,
        language: request.language,
      });
      candidate = searchResults.find((c) => c.tcgdexId === request.tcgdexId) ?? searchResults[0] ?? null;
    }

    if (!candidate) {
      throw new ScanServiceError('VALIDATION', 'Selected card not found for confirm');
    }

    const existing = this.deps.store.findCanonicalByFingerprint(
      request.language,
      request.tcgdexId
    );
    const cardflowCardId = existing?.cardflowCardId ?? mintCardflowCardId();
    const cardsightCardId =
      request.cardsightCardId ??
      scan.recognition.cardsightCardId ??
      candidate.cardsightCardId;

    const canonicalCard = toCanonicalCard(
      cardflowCardId,
      candidate,
      cardsightCardId,
      request.selectedVariant ?? null
    );

    const mintedAt = existing?.mintedAt ?? new Date().toISOString();
    if (!existing) {
      this.deps.store.saveCanonicalCard(
        toPersistedCanonical(canonicalCard, request.matchMethod, mintedAt)
      );
    }

    const confirmation: CrmConfirmation = {
      confirmationId: randomUUID(),
      scanId,
      userId: scan.userId,
      confirmedAt: new Date().toISOString(),
      cardflowCardId,
      language: request.language,
      tcgdexId: request.tcgdexId,
      cardsightCardId,
      matchMethod: request.matchMethod,
      selectedVariant: request.selectedVariant ?? null,
      canonicalCard,
    };

    this.deps.store.saveConfirmation(confirmation);
    this.deps.store.updateScan(scanId, {
      preInventoryState: 'identity_confirmed',
      cardflowCardId,
    });

    return confirmation;
  }

  rejectScan(scanId: string): CrmScan {
    const scan = this.deps.store.getScan(scanId);
    if (!scan) {
      throw new ScanServiceError('NOT_FOUND', 'Scan not found');
    }

    return this.deps.store.updateScan(scanId, {
      preInventoryState: 'identity_rejected',
      cardflowCardId: null,
    })!;
  }
}

export class ScanServiceError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'ALREADY_CONFIRMED' | 'VALIDATION',
    message: string
  ) {
    super(message);
    this.name = 'ScanServiceError';
  }
}
