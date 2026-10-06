import { crmValueForUser } from "@cardflow/shared";

export type LivestreamPlatform = "whatnot" | "ebay";

export interface LivestreamPlatformChrome {
  badge: string;
  label: string;
  urlLabel: string;
  pageUrl: string;
  liveRegionLabel: string;
}

export const DEFAULT_LIVESTREAM_PLATFORM: LivestreamPlatform = "whatnot";

export const LIVESTREAM_PLATFORM_ORDER: readonly LivestreamPlatform[] = ["whatnot", "ebay"];

export const LIVESTREAM_PLATFORMS: Record<LivestreamPlatform, LivestreamPlatformChrome> = {
  whatnot: {
    badge: "W",
    label: "Whatnot",
    urlLabel: "www.whatnot.com",
    pageUrl: "https://www.whatnot.com",
    liveRegionLabel: "WebView: Whatnot live page",
  },
  ebay: {
    badge: "e",
    label: "eBay",
    urlLabel: "www.ebay.com/ebaylive",
    pageUrl: "https://www.ebay.com/ebaylive",
    liveRegionLabel: "WebView: eBay live page",
  },
};

export interface LivestreamOverlayCard {
  userId: string;
  cardflowCardId: string;
  name: string;
  imageUrl: string | null;
  referenceAmount: string | null;
  maxBuyAmount: string | null;
}

let overlayCard: LivestreamOverlayCard | null = null;

function cloneOverlayCard(card: LivestreamOverlayCard): LivestreamOverlayCard {
  return {
    userId: card.userId,
    cardflowCardId: card.cardflowCardId,
    name: card.name,
    imageUrl: card.imageUrl,
    referenceAmount: card.referenceAmount,
    maxBuyAmount: card.maxBuyAmount,
  };
}

export function livestreamOverlayForUser(
  card: LivestreamOverlayCard | null,
  userId: string | null,
): LivestreamOverlayCard | null {
  const owned = crmValueForUser(card, userId);
  return owned ? cloneOverlayCard(owned) : null;
}

export function getLivestreamOverlayCard(): LivestreamOverlayCard | null {
  return overlayCard ? cloneOverlayCard(overlayCard) : null;
}

export function getLivestreamOverlayCardForUser(
  userId: string | null,
): LivestreamOverlayCard | null {
  return livestreamOverlayForUser(overlayCard, userId);
}

export function clearLivestreamOverlay(): void {
  overlayCard = null;
}

export function setLivestreamOverlayCard(card: LivestreamOverlayCard | null): void {
  overlayCard = card ? cloneOverlayCard(card) : null;
}

export function patchLivestreamOverlayCard(
  cardflowCardId: string,
  patch: Partial<Pick<LivestreamOverlayCard, "referenceAmount" | "maxBuyAmount">>,
): void {
  if (!overlayCard || overlayCard.cardflowCardId !== cardflowCardId) return;
  overlayCard = {
    ...overlayCard,
    ...patch,
  };
}

export function overlayDollarLabel(amount: string | null, emptyLabel: string): string {
  if (!amount) return emptyLabel;
  return amount.startsWith("$") ? amount : `$${amount}`;
}
