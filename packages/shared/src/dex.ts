/**
 * MyDEX set view (Sean, Oct 19): every English card in a set, shown with its official TCGdex
 * catalog image. Owned cards are full color; the rest are greyed. A card counts as owned once a
 * scan of it is confirmed or it is in the collection as purchased. No photos, no CardSight.
 */

export interface DexCatalogCard {
  id: string;
  localId: string;
  name: string;
  /** TCGdex image base URL (no quality/extension), or null when TCGdex has no art. */
  image: string | null;
}

export interface DexCard {
  tcgdexId: string;
  localId: string;
  name: string;
  /** Small cached catalog thumbnail (TCGdex `low.webp`). */
  thumbUrl: string | null;
  owned: boolean;
}

export interface DexSetSummary {
  setId: string;
  name: string;
  logo: string | null;
  owned: number;
  total: number;
}

export interface DexSetView extends DexSetSummary {
  cards: DexCard[];
}

export function dexThumbUrl(imageBase: string | null | undefined): string | null {
  if (!imageBase) return null;
  return `${imageBase.replace(/\/+$/, "")}/low.webp`;
}

/** `base1-58` -> `base1`. TCGdex ids are `<setId>-<localId>`; set ids may contain dashes. */
export function dexSetIdOf(tcgdexId: string): string {
  const i = tcgdexId.lastIndexOf("-");
  return i > 0 ? tcgdexId.slice(0, i) : tcgdexId;
}

function localIdOrder(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, "en", { numeric: true });
}

export function buildDexSet(
  set: { setId: string; name: string; logo?: string | null },
  catalogCards: readonly DexCatalogCard[],
  ownedTcgdexIds: ReadonlySet<string>,
): DexSetView {
  const cards = [...catalogCards]
    .sort((a, b) => localIdOrder(a.localId, b.localId))
    .map((card) => ({
      tcgdexId: card.id,
      localId: card.localId,
      name: card.name,
      thumbUrl: dexThumbUrl(card.image),
      owned: ownedTcgdexIds.has(card.id),
    }));
  return {
    setId: set.setId,
    name: set.name,
    logo: set.logo ?? null,
    owned: cards.filter((card) => card.owned).length,
    total: cards.length,
    cards,
  };
}

/** Owned cards per set id. */
export function dexOwnedCountsBySet(ownedTcgdexIds: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ownedTcgdexIds) {
    const setId = dexSetIdOf(id);
    counts.set(setId, (counts.get(setId) ?? 0) + 1);
  }
  return counts;
}

export function dexProgressLabel(owned: number, total: number): string {
  return `${owned}/${total}`;
}

/** Style for a card tile: unowned is greyed (low opacity + grayscale where supported). */
export function dexTileTone(owned: boolean): { opacity: number; grayscale: boolean } {
  return owned ? { opacity: 1, grayscale: false } : { opacity: 0.35, grayscale: true };
}
