/**
 * Map TCGCSV (TCGplayer dumps) products onto TCGdex catalog ids.
 *
 * Catalog identity stays TCGdex `{setId}-{localId}`. TCGCSV product ids are never
 * inventory keys. Unmatched products (unknown set, sealed, non-English) are skipped
 * — we do not invent catalog ids.
 *
 * Printing subtypes (TCGCSV `subTypeName`) are stored as the same variant keys
 * pokemontcg.io used so movers stay comparable:
 *   Normal → normal
 *   Holofoil → holofoil
 *   Reverse Holofoil → reverseHolofoil
 *   1st Edition → 1stEdition
 *   1st Edition Holofoil → 1stEditionHolofoil
 *   Unlimited → unlimited
 *   Unlimited Holofoil → unlimitedHolofoil
 * Unknown printings are camelCased and kept (not dropped). Missing marketPrice skips that finish.
 *
 * English only: groups whose name looks non-English (Japanese, Korean, etc.) are skipped.
 * Shadowless Base Set maps onto `base1` because TCGdex has one Base Set; printings stay
 * distinct via subtype. Dual trainer kits and sealed products are unmatched/skipped.
 */
import { TCGCSV_GROUP_NAME_TO_TCGDEX, TCGDEX_ENGLISH_SET_IDS } from "./tcgcsv-sets";
import { normalizeSetName, tcgdexSetIdForName } from "./set-name-map";

export const TCGCSV_PRODUCT_ID_PREFIX = "tcgcsv:";

export type TcgcsvMappingStatus = "matched" | "unmatched";
export type TcgcsvMappingMethod =
  | "group_name"
  | "era_code"
  | "set_name"
  | "unmatched";

export interface TcgcsvExtendedDatum {
  name?: string | null;
  displayName?: string | null;
  value?: string | null;
}

export interface TcgcsvGroupRef {
  groupId: number;
  name: string;
  abbreviation?: string | null;
}

export interface TcgcsvProductRef {
  productId: number;
  name?: string | null;
  imageUrl?: string | null;
  extendedData?: TcgcsvExtendedDatum[] | null;
}

export interface TcgcsvPriceRef {
  productId: number;
  marketPrice?: number | null;
  subTypeName?: string | null;
}

export interface TcgcsvMapResult {
  externalId: string;
  productId: number;
  tcgdexId: string | null;
  tcgdexSetId: string | null;
  localId: string | null;
  status: TcgcsvMappingStatus;
  method: TcgcsvMappingMethod;
  unmatchedReason?: string;
}

const NON_ENGLISH_GROUP =
  /\b(japanese|japan|korean|chinese|simplified chinese|traditional chinese|indonesian|thai|french|german|italian|spanish|portuguese)\b|\bjp exclusive\b|\(jp\b/i;

/** TCGCSV `subTypeName` → pokemontcg.io-style variant keys used by Trending labels. */
export const TCGCSV_SUBTYPE_TO_VARIANT: Readonly<Record<string, string>> = {
  normal: "normal",
  holofoil: "holofoil",
  holo: "holofoil",
  "reverse holofoil": "reverseHolofoil",
  reverseholofoil: "reverseHolofoil",
  "1st edition": "1stEdition",
  "1st edition normal": "1stEdition",
  "1st edition holofoil": "1stEditionHolofoil",
  "unlimited": "unlimited",
  "unlimited holofoil": "unlimitedHolofoil",
};

const ERA_FROM_NAME = /^(SWSH|SM|SV|ME)(\d+)(?:\.(\d+))?/i;
const ERA_STRIP = /^(?:SWSH|SM|SV|ME|XY|EX|HGSS|DP|BW|PL)\d*(?:\.\d+)?\s*:\s*/i;
const DASH_STRIP = /^(?:SM|XY|EX)\s*[-–]\s*/i;
const COLON_STRIP = /^(?:SV|SWSH|ME|SM|XY|EX):\s*/i;
const EX_STRIP = /^EX\s+/i;
const PROMO_SET_KEEP_PREFIX = /^(swshp|smp|xyp|bwp|dpp|hgssp|mep)$/;
const PADDED_SET = /^(sv\d|svp$|me\d)/;

export function tcgcsvExternalId(productId: number | string): string {
  return `${TCGCSV_PRODUCT_ID_PREFIX}${productId}`;
}

export function isEnglishTcgcsvGroupName(name: string | null | undefined): boolean {
  if (!name?.trim()) return true;
  return !NON_ENGLISH_GROUP.test(name);
}

export function tcgcsvExtendedValue(product: TcgcsvProductRef, key: string): string | null {
  for (const row of product.extendedData ?? []) {
    if (row.name === key && typeof row.value === "string" && row.value.trim()) return row.value.trim();
  }
  return null;
}

export function tcgcsvCollectorNumber(product: TcgcsvProductRef): string | null {
  return tcgcsvExtendedValue(product, "Number");
}

/** True when the product looks like a single card (has a collector number). */
export function tcgcsvProductIsCard(product: TcgcsvProductRef): boolean {
  return Boolean(tcgcsvCollectorNumber(product));
}

export function tcgcsvSubtypeToVariant(subTypeName: string | null | undefined): string | null {
  if (!subTypeName?.trim()) return null;
  const folded = subTypeName.trim().toLowerCase().replace(/\s+/g, " ");
  const mapped = TCGCSV_SUBTYPE_TO_VARIANT[folded];
  if (mapped) return mapped;
  const words = folded.split(" ");
  return words
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}

export function marketUsdToCents(market: unknown): number | null {
  if (typeof market !== "number" || !Number.isFinite(market) || market < 0) return null;
  return Math.round(market * 100);
}

export function tcgcsvFinishesFromPrices(
  prices: TcgcsvPriceRef[],
  productId: number,
): Array<{ variant: string; cents: number }> {
  const out: Array<{ variant: string; cents: number }> = [];
  const seen = new Set<string>();
  for (const row of prices) {
    if (row.productId !== productId) continue;
    const variant = tcgcsvSubtypeToVariant(row.subTypeName);
    const cents = marketUsdToCents(row.marketPrice);
    if (!variant || cents == null || seen.has(variant)) continue;
    seen.add(variant);
    out.push({ variant, cents });
  }
  return out;
}

function knownSet(id: string | null | undefined): string | null {
  if (!id) return null;
  return TCGDEX_ENGLISH_SET_IDS.has(id) ? id : null;
}

function stripTcgplayerSetPrefix(name: string): string {
  return name
    .replace(ERA_STRIP, "")
    .replace(DASH_STRIP, "")
    .replace(COLON_STRIP, "")
    .replace(EX_STRIP, "")
    .trim();
}

function eraCodeFromTcgcsv(group: TcgcsvGroupRef): string | null {
  const sources = [group.name.replace(/\s+/g, ""), group.abbreviation ?? ""];
  for (const source of sources) {
    const match = ERA_FROM_NAME.exec(source);
    if (!match) continue;
    const era = match[1]!.toLowerCase();
    const n = match[2]!;
    const half = match[3] ? `.${match[3]}` : "";
    const padded = era === "sv" || era === "me";
    const id = padded ? `${era}${n.padStart(2, "0")}${half}` : `${era}${Number(n)}${half}`;
    const known = knownSet(id);
    if (known) return known;
  }
  return null;
}

export function mapTcgcsvGroupToTcgdexSet(group: TcgcsvGroupRef): {
  tcgdexSetId: string | null;
  method: TcgcsvMappingMethod;
  unmatchedReason?: string;
} {
  if (!isEnglishTcgcsvGroupName(group.name)) {
    return { tcgdexSetId: null, method: "unmatched", unmatchedReason: "non_english" };
  }

  const exact = knownSet(TCGCSV_GROUP_NAME_TO_TCGDEX[group.name]);
  if (exact) return { tcgdexSetId: exact, method: "group_name" };

  const stripped = stripTcgplayerSetPrefix(group.name);
  const byName =
    knownSet(tcgdexSetIdForName(group.name)) ??
    knownSet(tcgdexSetIdForName(stripped)) ??
    knownSet(tcgdexSetIdForName(normalizeSetName(stripped)));
  if (byName) return { tcgdexSetId: byName, method: "set_name" };

  const era = eraCodeFromTcgcsv(group);
  if (era) return { tcgdexSetId: era, method: "era_code" };

  return {
    tcgdexSetId: null,
    method: "unmatched",
    unmatchedReason: `unknown_set:${group.name}`,
  };
}

/**
 * Local id from a TCGCSV Number field (`013/198`, `TG01/TG30`, `SWSH001`).
 * SV / Mega Evolution numeric ids are 3-digit; WotC / SM / SWSH main sets are unpadded;
 * SWSH/SM/XY promo sets keep the printed prefix (`SWSH001`, `SM01`).
 */
export function tcgcsvLocalId(tcgdexSetId: string, rawNumber: string): string {
  const printed = rawNumber.split("/")[0]?.trim() ?? "";
  if (!printed) return printed;
  if (PROMO_SET_KEEP_PREFIX.test(tcgdexSetId)) return printed;
  const stripped = printed.replace(/^(SWSH|SVP|SM|XY|BW|DP|HGSS|ME|SV)(?=\d)/i, "");
  if (/^\d+$/.test(stripped)) {
    const digits = stripped.replace(/^0+/, "") || "0";
    if (PADDED_SET.test(tcgdexSetId)) return digits.padStart(3, "0");
    return digits;
  }
  return printed;
}

export function mapTcgcsvProductToTcgdex(product: TcgcsvProductRef, group: TcgcsvGroupRef): TcgcsvMapResult {
  const productId = product.productId;
  const externalId = tcgcsvExternalId(productId);
  const base = {
    externalId,
    productId,
    tcgdexId: null as string | null,
    tcgdexSetId: null as string | null,
    localId: null as string | null,
  };

  if (!Number.isFinite(productId) || productId <= 0) {
    return { ...base, status: "unmatched", method: "unmatched", unmatchedReason: "id_unparseable" };
  }
  if (!isEnglishTcgcsvGroupName(group.name)) {
    return { ...base, status: "unmatched", method: "unmatched", unmatchedReason: "non_english" };
  }
  if (!tcgcsvProductIsCard(product)) {
    return { ...base, status: "unmatched", method: "unmatched", unmatchedReason: "not_a_card" };
  }

  const mappedSet = mapTcgcsvGroupToTcgdexSet(group);
  if (!mappedSet.tcgdexSetId) {
    return {
      ...base,
      status: "unmatched",
      method: "unmatched",
      unmatchedReason: mappedSet.unmatchedReason ?? "unknown_set",
    };
  }

  const number = tcgcsvCollectorNumber(product)!;
  const localId = tcgcsvLocalId(mappedSet.tcgdexSetId, number);
  if (!localId) {
    return {
      ...base,
      tcgdexSetId: mappedSet.tcgdexSetId,
      status: "unmatched",
      method: "unmatched",
      unmatchedReason: "missing_set_or_number",
    };
  }

  return {
    externalId,
    productId,
    tcgdexId: `${mappedSet.tcgdexSetId}-${localId}`,
    tcgdexSetId: mappedSet.tcgdexSetId,
    localId,
    status: "matched",
    method: mappedSet.method,
  };
}
