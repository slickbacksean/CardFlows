import { CATALOG_UNAVAILABLE_MESSAGE } from "./catalog-flags";
import {
  catalogFingerprint,
  findCardByTcgdexId,
  toCanonicalCard,
} from "./mock-catalog";
import type {
  CardFlowCanonicalCard,
  CatalogMappingResult,
  MatchMethod,
} from "./types";

export interface ConfirmIdentityInput {
  mapping: CatalogMappingResult;
  selectedTcgdexId: string;
  selectedVariant?: string | null;
  existingCardflowCardId?: string | null;
  createId?: () => string;
  /**
   * Catalog snapshot to cache on the canonical row.
   * `null` means lookup missed — do not fall back to mock fixtures.
   * Omitted means the live catalog was unavailable.
   */
  catalogCard?: CardFlowCanonicalCard | null;
  /** Tests only. Live Confirm never looks up MOCK_CARDS. */
  allowMockCatalog?: boolean;
}

export interface ConfirmIdentityResult {
  ok: true;
  confirmationRequiredHonored: true;
  matchMethod: MatchMethod;
  mintedCardflowCardId: boolean;
  canonicalCard: CardFlowCanonicalCard;
}

export function catalogCardFromMapping(
  mapping: CatalogMappingResult,
  selectedTcgdexId: string,
): CardFlowCanonicalCard | null {
  if (mapping.canonicalCard?.tcgdexId === selectedTcgdexId) return mapping.canonicalCard;
  return mapping.candidates.find((card) => card.tcgdexId === selectedTcgdexId) ?? null;
}

function resolveConfirmCatalogCard(input: ConfirmIdentityInput): CardFlowCanonicalCard {
  if (input.catalogCard && input.catalogCard.tcgdexId === input.selectedTcgdexId) {
    return input.catalogCard;
  }
  const fromMapping = catalogCardFromMapping(input.mapping, input.selectedTcgdexId);
  if (fromMapping) return fromMapping;
  if (input.allowMockCatalog) {
    const catalogCard = findCardByTcgdexId(input.selectedTcgdexId);
    if (!catalogCard) {
      throw new Error(`Cannot confirm unknown tcgdexId: ${input.selectedTcgdexId}`);
    }
    return toCanonicalCard(catalogCard);
  }
  if (input.catalogCard === null) {
    throw new Error(`Cannot confirm unknown tcgdexId: ${input.selectedTcgdexId}`);
  }
  throw new Error(CATALOG_UNAVAILABLE_MESSAGE);
}

export function confirmIdentity(input: ConfirmIdentityInput): ConfirmIdentityResult {
  const snapshot = resolveConfirmCatalogCard(input);
  const selected = catalogCardFromMapping(input.mapping, input.selectedTcgdexId);
  const cardsightCardId =
    snapshot.cardsightCardId ?? selected?.cardsightCardId ?? input.mapping.cardsightCardId ?? null;
  const existingId = input.existingCardflowCardId ?? null;
  const mintedCardflowCardId = !existingId;
  const cardflowCardId = existingId ?? (input.createId ? input.createId() : crypto.randomUUID());
  const matchMethod: MatchMethod =
    input.mapping.status === "matched" &&
    input.mapping.canonicalCard?.tcgdexId === input.selectedTcgdexId
      ? "identify"
      : "manual";

  const canonicalCard: CardFlowCanonicalCard = {
    ...snapshot,
    cardflowCardId,
    language: snapshot.language || "en",
    tcgdexId: input.selectedTcgdexId,
    cardsightCardId,
    selectedVariant: input.selectedVariant ?? selected?.selectedVariant ?? snapshot.selectedVariant,
    mintedOn: "confirm",
    matchMethod,
    mappingConfidence: input.mapping.confidence,
    mappingStatus: "matched",
    catalogFingerprint: catalogFingerprint("en", input.selectedTcgdexId),
    image: {
      ...snapshot.image,
      source: "tcgdex_assets",
    },
  };

  return {
    ok: true,
    confirmationRequiredHonored: true,
    matchMethod,
    mintedCardflowCardId,
    canonicalCard,
  };
}
