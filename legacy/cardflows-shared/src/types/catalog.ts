/** TCGdex language path codes. MVP uses 'en' only. */
export type TcgdexLanguage =
  | 'en'
  | 'fr'
  | 'es'
  | 'it'
  | 'pt'
  | 'pt-br'
  | 'pt-pt'
  | 'de'
  | 'nl'
  | 'pl'
  | 'ru'
  | 'ja'
  | 'ko'
  | 'zh-tw'
  | 'id'
  | 'th'
  | 'zh-cn';

export type TcgdexCategory = 'Pokemon' | 'Energy' | 'Trainer';

/** Documented variants booleans. wPromo may appear on wire examples. */
export interface TcgdexVariants {
  normal: boolean;
  reverse: boolean;
  holo: boolean;
  firstEdition: boolean;
  wPromo?: boolean;
}

export type SelectedVariant = 'normal' | 'reverse' | 'holo' | 'firstEdition';

export interface TcgdexSetBrief {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount: {
    total: number;
    official: number;
  };
}

/** Catalog card after adapter strip. No pricing. */
export interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  image: string | null;
  category: TcgdexCategory;
  illustrator: string | null;
  rarity: string | null;
  set: TcgdexSetBrief;
  variants: TcgdexVariants;
  language: TcgdexLanguage;
}

export type MappingConfidence = 'High' | 'Medium' | 'Low' | 'Unresolved';

export type MappingStatus =
  | 'matched'
  | 'ambiguous'
  | 'no_match'
  | 'provider_conflict'
  | 'catalog_unavailable';

export interface CardFlowCanonicalCard {
  cardflowCardId: string | null;
  language: TcgdexLanguage;
  tcgdexId: string;
  tcgdexSetId: string;
  localId: string;
  name: string;
  category: TcgdexCategory;
  rarity: string | null;
  variants: TcgdexVariants;
  selectedVariant: SelectedVariant | null;
  image: {
    baseUrl: string | null;
    source: 'tcgdex_assets';
    quality: 'high' | 'low';
    extension: 'webp' | 'png' | 'jpg';
    constructedUrl: string | null;
    provenance: string;
  };
  cardsightCardId: string | null;
  set?: TcgdexSetBrief;
  rank?: number;
  matchedOn?: Array<'language' | 'set' | 'localId' | 'name' | 'variant' | 'tcgdexId'>;
}

export interface CatalogError {
  code:
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_UNAVAILABLE'
    | 'NOT_FOUND'
    | 'BAD_REQUEST'
    | 'FEATURE_DISABLED'
    | 'UNKNOWN';
  httpStatus?: number;
  message: string;
  retryable: boolean;
}

export interface CatalogLookupRequest {
  language: TcgdexLanguage;
  tcgdexId?: string | null;
  setId?: string | null;
  setName?: string | null;
  localId?: string | null;
  name?: string | null;
  variantHint?: SelectedVariant | null;
}

export interface CardCatalogProvider {
  readonly name: 'tcgdex' | 'mock';
  getCardById(id: string, language: TcgdexLanguage): Promise<TcgdexCard | null>;
  getCardBySetAndLocalId(
    setId: string,
    localId: string,
    language: TcgdexLanguage
  ): Promise<TcgdexCard | null>;
  resolveSetByName(name: string, language: TcgdexLanguage): Promise<TcgdexSetBrief[]>;
  listCards(req: CatalogLookupRequest): Promise<TcgdexCard[]>;
}

export interface CardFlowNormalizedMappingResult {
  provider: 'tcgdex' | 'mock';
  ok: boolean;
  confidence: MappingConfidence;
  status: MappingStatus;
  matchedOn: Array<'language' | 'set' | 'localId' | 'name' | 'variant' | 'tcgdexId'>;
  cardflowCardId: string | null;
  tcgdexId: string | null;
  cardsightCardId: string | null;
  canonicalCard: CardFlowCanonicalCard | null;
  candidates: CardFlowCanonicalCard[];
  error: CatalogError | null;
  _meta?: { mocked?: boolean; description?: string };
}

export interface CardIdentityMapper {
  mapRecognitionToCatalog(input: {
    language: string | null;
    setName: string | null;
    number: string | null;
    name: string | null;
    vendorCardId: string | null;
    variantHint?: SelectedVariant | null;
  }): Promise<CardFlowNormalizedMappingResult>;
}
