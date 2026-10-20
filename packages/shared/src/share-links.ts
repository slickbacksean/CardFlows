/**
 * D12 / P2-05: sharing with **no reward and no referral code**. A share is a short text line
 * plus a deep link that opens the card in PokeSniper. No personal data, no prices beyond what
 * the user chose to share (a flip they recorded), never an estimate presented as a sale.
 */
import { shareCardFlipLine } from "./share-card-copy";

export const CARD_DEEP_LINK_SCHEME = "cardflow";
const TCGDEX_ID = /^[a-z0-9][a-z0-9.-]{0,40}-[a-z0-9]{1,12}$/i;

export function isShareableTcgdexId(id: string | null | undefined): id is string {
  return typeof id === "string" && TCGDEX_ID.test(id);
}

/** `cardflow://card/base1-58`. Null for anything that isn't a catalog ID. */
export function cardDeepLink(tcgdexId: string | null | undefined): string | null {
  return isShareableTcgdexId(tcgdexId) ? `${CARD_DEEP_LINK_SCHEME}://card/${encodeURIComponent(tcgdexId)}` : null;
}

/** Parses `cardflow://card/<id>` (or a path `/card/<id>`). */
export function parseCardDeepLink(url: string): string | null {
  const match = /^(?:cardflow:\/\/|\/)card\/([^/?#]+)/i.exec(url.trim());
  if (!match) return null;
  const id = decodeURIComponent(match[1]!);
  return isShareableTcgdexId(id) ? id : null;
}

export function shareCardMessage(card: { name: string; number?: string | null; setName?: string | null; tcgdexId?: string | null }): string {
  const title = [card.name.trim(), card.number ? `#${card.number}` : null].filter(Boolean).join(" ");
  const line = card.setName ? `${title} · ${card.setName}` : title;
  const link = cardDeepLink(card.tcgdexId);
  return link ? `${line}\nOpen in PokeSniper: ${link}` : line;
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Only for a recorded sale with a known cost (realized). Null otherwise. */
export function shareFlipMessage(input: {
  name: string;
  costCents: number | null;
  saleCents: number | null;
  realized: boolean;
  tcgdexId?: string | null;
}): string | null {
  if (!input.realized || input.costCents === null || input.saleCents === null) return null;
  const line = `${input.name.trim()}: ${shareCardFlipLine(dollars(input.costCents), dollars(input.saleCents))}`;
  const link = cardDeepLink(input.tcgdexId);
  return link ? `${line}\nOpen in PokeSniper: ${link}` : line;
}
