import { centsToDollarString, optionalDollarsToCents } from "./money";
import type {
  ClipboardExport,
  CostToAskSpread,
  DisclosureAnswers,
  ListingDraft,
  ListingTitleContext,
  TitleTemplateId,
} from "./types";

export const LISTING_AI_COPY_ENABLED = false as const;
export const LISTING_DRAFTS_ENABLED = true as const;

export const CONDITION_LABELS = ["NM", "LP", "MP", "HP", "DMG"] as const;

export const DISCLOSURE_ITEMS = [
  {
    id: "corners",
    label: "Corners",
    answers: ["sharp", "light whitening", "soft", "peels"],
  },
  {
    id: "edges",
    label: "Edges",
    answers: ["clean", "whitening", "nicks"],
  },
  {
    id: "surface",
    label: "Surface",
    answers: ["clean", "light scratches", "light sleeve scuffs", "holo swirl notes"],
  },
  {
    id: "whitening",
    label: "Whitening",
    answers: ["none noted", "corners", "edges"],
  },
  {
    id: "centering",
    label: "Centering",
    answers: ["looks good", "slightly off", "obviously off"],
  },
] as const;

export const GRADING_PILLAR_IDS = [
  "centering",
  "corners",
  "edges",
  "surface",
] as const;

export const GRADING_PILLARS = GRADING_PILLAR_IDS.map((id) => {
  const item = DISCLOSURE_ITEMS.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Missing listing-draft disclosure item: ${id}`);
  }
  return item;
});

export function variantOrRaw(selectedVariant: string | null | undefined): string {
  const trimmed = selectedVariant?.trim();
  return trimmed ? trimmed : "Raw";
}

export function renderListingTitle(
  context: ListingTitleContext,
  templateId: TitleTemplateId = "default_en_raw_single",
): string {
  const variant = variantOrRaw(context.selectedVariant);
  const identity = `${context.name} - ${context.setName} #${context.localId} [${variant}] EN`;
  if (templateId === "en_raw_single_with_condition" && context.condition?.trim()) {
    return `${identity} ${context.condition.trim()}`;
  }
  return identity;
}

export function descriptionStarter(context: ListingTitleContext): string {
  const variant = variantOrRaw(context.selectedVariant);
  const identity = `${context.name} — ${context.setName} #${context.localId} — English — ${variant}${variant === "Raw" ? "" : " (Raw)"}`;
  const condition = context.condition?.trim();
  if (!condition) return identity;
  return `${identity}\nCondition: ${condition}`;
}

export function keywordChips(context: ListingTitleContext): string[] {
  return [
    context.name,
    context.setName,
    context.localId,
    "raw",
    "English",
    variantOrRaw(context.selectedVariant),
  ];
}

export function computeCostToAskSpread(input: {
  askingPrice: string | number | null | undefined;
  allInTotal: string | number | null | undefined;
  currency?: string;
}): CostToAskSpread | null {
  const askingCents = optionalDollarsToCents(input.askingPrice ?? null);
  const allInCents = optionalDollarsToCents(input.allInTotal ?? null);
  if (askingCents === null || allInCents === null) return null;
  const spreadCents = askingCents - allInCents;
  const currency = input.currency ?? "USD";
  const askingPrice = centsToDollarString(askingCents);
  const allInTotal = centsToDollarString(allInCents);
  const spread = centsToDollarString(spreadCents);
  return {
    allInTotal,
    askingPrice,
    currency,
    spread,
    spreadCents,
    label: "spread / cost-to-ask gap",
    neverLabelAsProfit: true,
    display: `Asking: $${askingPrice}\nAll-in cost: $${allInTotal}\nSpread (cost-to-ask gap): $${spread}`,
  };
}

export function readyForReviewMissing(draft: Pick<
  ListingDraft,
  "title" | "condition" | "askingPrice"
>): string[] {
  const missing: string[] = [];
  if (!draft.title.trim()) missing.push("title");
  if (!draft.condition?.trim()) missing.push("condition");
  if (optionalDollarsToCents(draft.askingPrice) === null) missing.push("asking_price");
  return missing;
}

export function listingDraftStatusLabel(status: string): string {
  if (status === "ready_for_review") return "Ready for review";
  if (status === "draft") return "Draft";
  return "Draft";
}

export function canMarkReadyForReview(
  draft: Pick<ListingDraft, "title" | "condition" | "askingPrice">,
): boolean {
  return readyForReviewMissing(draft).length === 0;
}

export interface CopyListingDraftRef {
  draftId: string;
  status: string;
  title?: string | null;
}

export interface CopyListingInventoryItem {
  intent: "purchased" | "watchlist";
  createdAt: string;
  draft?: CopyListingDraftRef | null;
  card?: { name?: string | null } | null;
}

export interface ReadyToCopyRow {
  draftId: string;
  status: string;
  label: string;
}

function purchasedItemsWithDrafts(
  items: readonly CopyListingInventoryItem[],
): CopyListingInventoryItem[] {
  return items.filter((item) => item.intent === "purchased" && Boolean(item.draft?.draftId));
}

export function selectCopyListingDraft(
  items: readonly CopyListingInventoryItem[],
): CopyListingDraftRef | null {
  const purchasedDrafts = purchasedItemsWithDrafts(items);
  if (purchasedDrafts.length === 0) return null;

  const ready = purchasedDrafts.filter((item) => item.draft?.status === "ready_for_review");
  const pool = ready.length > 0 ? ready : purchasedDrafts;
  const newest = [...pool].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return newest?.draft ?? null;
}

export function listPurchasedDraftsForCopy(
  items: readonly CopyListingInventoryItem[],
): ReadyToCopyRow[] {
  return purchasedItemsWithDrafts(items)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .flatMap((item) => {
      const draft = item.draft;
      if (!draft) return [];
      const title = draft.title?.trim();
      const cardName = item.card?.name?.trim();
      return [
        {
          draftId: draft.draftId,
          status: draft.status,
          label: title || cardName || "Listing draft",
        },
      ];
    });
}

export function formatClipboardPlainText(input: {
  title: string;
  description: string;
  condition: string | null;
  askingPrice: string | null;
  currency: string;
}): string {
  const asking =
    input.askingPrice && input.askingPrice.trim()
      ? `${input.askingPrice} ${input.currency}`
      : "";
  return [
    `Title: ${input.title}`,
    `Condition: ${input.condition?.trim() ?? ""}`,
    `Asking: ${asking}`.trimEnd(),
    "",
    "Description:",
    input.description,
  ].join("\n");
}

export function buildClipboardExport(input: {
  title: string;
  description: string;
  condition: string | null;
  askingPrice: string | null;
  currency: string;
  notes?: string | null;
  intendedChannelNote?: string | null;
}): ClipboardExport {
  void input.notes;
  void input.intendedChannelNote;
  return {
    exportKind: "clipboard",
    published: false,
    trigger: "user_tap_copy",
    autoCopyOnSave: false,
    disclaimer:
      "CardFlow clipboard export only. CardFlow did not publish this listing to any marketplace.",
    plainText: formatClipboardPlainText(input),
    includedFields: ["title", "description", "condition", "asking_price", "currency"],
    omittedPrivateNotes: true,
    omittedChannelNote: true,
  };
}

export function disclosureSnippet(answers: DisclosureAnswers): string {
  const lines: string[] = [];
  for (const item of DISCLOSURE_ITEMS) {
    const answer = answers[item.id]?.trim();
    if (answer) lines.push(`${item.label}: ${answer}.`);
  }
  return lines.join(" ");
}

export function appendSnippet(existing: string, snippet: string): string {
  const trimmedSnippet = snippet.trim();
  if (!trimmedSnippet) return existing;
  if (existing.includes(trimmedSnippet)) return existing;
  return existing.trim() ? `${existing.trim()}\n${trimmedSnippet}` : trimmedSnippet;
}
