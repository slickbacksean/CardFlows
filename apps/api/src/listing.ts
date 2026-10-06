import {
  buildClipboardExport,
  canMarkReadyForReview,
  computeCostToAskSpread,
  descriptionStarter,
  LISTING_AI_COPY_ENABLED,
  LOCKED_DISPLAY_CURRENCY,
  readyForReviewMissing,
  renderListingTitle,
  stripCatalogPricing,
  type CardFlowCanonicalCard,
  type ListingDraft,
  type TitleTemplateId,
} from "@cardflow/shared";
import type { InventoryItemRecord } from "./store";

export function catalogDisplayFromCard(
  card: CardFlowCanonicalCard,
  selectedVariant: string | null,
) {
  const stripped = stripCatalogPricing(card);
  return stripCatalogPricing({
    name: stripped.name,
    setName: stripped.set.name,
    localId: stripped.localId,
    language: stripped.language,
    rarity: stripped.rarity,
    selectedVariant,
    image: {
      ...stripped.image,
      notAUserListingPhoto: true as const,
    },
  });
}

export function titleContextFrom(
  card: CardFlowCanonicalCard,
  item: InventoryItemRecord,
  condition: string | null,
) {
  return {
    name: card.name,
    setName: card.set.name,
    localId: card.localId,
    selectedVariant: item.selectedVariant,
    condition,
  };
}

export function createPrefillDraft(input: {
  item: InventoryItemRecord;
  card: CardFlowCanonicalCard;
  now?: string;
  createId?: () => string;
}): ListingDraft {
  const now = input.now ?? new Date().toISOString();
  const condition = input.item.condition;
  const context = titleContextFrom(input.card, input.item, condition);
  return {
    draftId: input.createId ? input.createId() : crypto.randomUUID(),
    inventoryItemId: input.item.inventoryItemId,
    userId: input.item.userId,
    cardflowCardId: input.item.cardflowCardId,
    status: "draft",
    title: renderListingTitle(context),
    description: descriptionStarter(context),
    condition,
    askingPrice: null,
    currency: LOCKED_DISPLAY_CURRENCY,
    quantity: 1,
    intendedChannelNote: "",
    notes: "",
    titleTemplateId: "default_en_raw_single",
    catalogDisplay: catalogDisplayFromCard(input.card, input.item.selectedVariant),
    publication: { published: false, marketplace: null },
    aiCopyEnabled: LISTING_AI_COPY_ENABLED,
    createdAt: now,
    updatedAt: now,
  };
}

export function applyDraftPatch(
  draft: ListingDraft,
  patch: {
    title?: string;
    description?: string;
    condition?: string | null;
    askingPrice?: string | null;
    intendedChannelNote?: string;
    notes?: string;
    titleTemplateId?: TitleTemplateId;
  },
  card: CardFlowCanonicalCard,
  item: InventoryItemRecord,
): ListingDraft {
  const titleTemplateId = patch.titleTemplateId ?? draft.titleTemplateId;
  const condition =
    patch.condition === undefined ? draft.condition : patch.condition;
  const next: ListingDraft = {
    ...draft,
    title: patch.title ?? draft.title,
    description: patch.description ?? draft.description,
    condition,
    askingPrice: patch.askingPrice === undefined ? draft.askingPrice : patch.askingPrice,
    intendedChannelNote: patch.intendedChannelNote ?? draft.intendedChannelNote,
    notes: patch.notes ?? draft.notes,
    titleTemplateId,
    currency: LOCKED_DISPLAY_CURRENCY,
    status: "draft",
    publication: { published: false, marketplace: null },
    aiCopyEnabled: LISTING_AI_COPY_ENABLED,
    updatedAt: new Date().toISOString(),
  };
  if (patch.titleTemplateId && patch.title === undefined) {
    next.title = renderListingTitle(
      titleContextFrom(card, item, next.condition),
      titleTemplateId,
    );
  }
  return next;
}

export function draftView(draft: ListingDraft, item: InventoryItemRecord) {
  const spread = computeCostToAskSpread({
    askingPrice: draft.askingPrice,
    allInTotal: item.purchase?.costBasis.allInTotal ?? null,
    currency: LOCKED_DISPLAY_CURRENCY,
  });
  return {
    draft,
    costToAsk: spread,
    allInTotal: item.purchase?.costBasis.allInTotal ?? null,
    readyForReview: {
      required: ["title", "condition", "asking_price"],
      missing: readyForReviewMissing(draft),
      canMark: canMarkReadyForReview(draft),
    },
    publication: draft.publication,
    aiCopyEnabled: LISTING_AI_COPY_ENABLED,
  };
}

export function clipboardForDraft(draft: ListingDraft) {
  return buildClipboardExport({
    title: draft.title,
    description: draft.description,
    condition: draft.condition,
    askingPrice: draft.askingPrice,
    currency: LOCKED_DISPLAY_CURRENCY,
    notes: draft.notes,
    intendedChannelNote: draft.intendedChannelNote,
  });
}
