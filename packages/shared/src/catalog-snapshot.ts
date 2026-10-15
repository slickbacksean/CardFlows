import type { CardFlowCanonicalCard } from "./types";
import { normalizeSetName, tcgdexSetIdForName } from "./set-name-map";

/** P1-04: small on-phone catalog snapshot for offline search. */
export const CATALOG_SNAPSHOT_VERSION = 1 as const;
export const CATALOG_SNAPSHOT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
export const CATALOG_SNAPSHOT_MAX_CARDS = 3000;

export interface CatalogSnapshotCard {
  tcgdexId: string;
  name: string;
  localId: string;
  setId: string;
  setName: string;
  imageUrl: string | null;
  /** Full card as last seen, so offline picks can open Decide. */
  card: CardFlowCanonicalCard;
}

export interface CatalogSnapshot {
  version: typeof CATALOG_SNAPSHOT_VERSION;
  updatedAt: string;
  cards: CatalogSnapshotCard[];
}

export function emptyCatalogSnapshot(now = new Date()): CatalogSnapshot {
  return { version: CATALOG_SNAPSHOT_VERSION, updatedAt: now.toISOString(), cards: [] };
}

export function snapshotCardFromCanonical(card: CardFlowCanonicalCard): CatalogSnapshotCard {
  return {
    tcgdexId: card.tcgdexId,
    name: card.name,
    localId: card.localId,
    setId: card.tcgdexSetId || card.set.id,
    setName: card.set.name,
    imageUrl: card.image?.constructedUrl ?? null,
    card,
  };
}

/** Adds or replaces cards (newest first), trimmed to the size cap. */
export function mergeIntoSnapshot(
  snapshot: CatalogSnapshot,
  cards: readonly CardFlowCanonicalCard[],
  now = new Date(),
): CatalogSnapshot {
  const fresh = cards.map(snapshotCardFromCanonical);
  const ids = new Set(fresh.map((c) => c.tcgdexId));
  return {
    version: CATALOG_SNAPSHOT_VERSION,
    updatedAt: now.toISOString(),
    cards: [...fresh, ...snapshot.cards.filter((c) => !ids.has(c.tcgdexId))].slice(0, CATALOG_SNAPSHOT_MAX_CARDS),
  };
}

export function snapshotIsStale(snapshot: CatalogSnapshot, now = Date.now()): boolean {
  return now - Date.parse(snapshot.updatedAt) > CATALOG_SNAPSHOT_REFRESH_MS;
}

export function parseCatalogSnapshot(raw: string | null | undefined): CatalogSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CatalogSnapshot>;
    if (value?.version !== CATALOG_SNAPSHOT_VERSION || !Array.isArray(value.cards)) return null;
    return value as CatalogSnapshot;
  } catch {
    return null;
  }
}

function normNumber(value: string): string {
  return value.trim().toLowerCase().replace(/^0+(?=\d)/, "").replace(/\/.*$/, "");
}

/** Offline search over the snapshot by set (name or ID), number and/or name. */
export function searchCatalogSnapshot(
  snapshot: CatalogSnapshot | null,
  query: { set?: string | null; number?: string | null; name?: string | null },
  limit = 25,
): CardFlowCanonicalCard[] {
  if (!snapshot) return [];
  const set = query.set?.trim() || null;
  const number = query.number?.trim() || null;
  const name = query.name?.trim().toLowerCase() || null;
  if (!set && !number && !name) return [];
  const setId = set ? (tcgdexSetIdForName(set) ?? set.toLowerCase()) : null;
  const setNorm = set ? normalizeSetName(set) : null;
  return snapshot.cards
    .filter((c) => {
      if (setId && c.setId.toLowerCase() !== setId && normalizeSetName(c.setName) !== setNorm) return false;
      if (number && normNumber(c.localId) !== normNumber(number)) return false;
      if (name && !c.name.toLowerCase().includes(name)) return false;
      return true;
    })
    .slice(0, limit)
    .map((c) => c.card);
}
