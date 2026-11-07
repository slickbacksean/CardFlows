/**
 * Map pokemontcg.io card ids onto TCGdex catalog ids (PokeSniper's catalog key).
 *
 * pokemontcg.io and TCGdex both use `{setId}-{number}`, but set ids and local ids
 * diverge on later eras (Scarlet & Violet zero-pads set numbers: `sv1` → `sv01`,
 * and many SV local ids are three-digit: `1` → `001`). Half-sets use `pt5` on
 * pokemontcg.io and `.5` on TCGdex (`sv3pt5` → `sv03.5`).
 *
 * Unmatched rows (unparseable ids) are stored with `mapping_status = unmatched`
 * and omitted from Trending — they cannot open `/shop/card`.
 */

import { tcgdexSetIdForName } from "./set-name-map";

export type PokemonTcgMappingMethod =
  | "exact_id"
  | "set_alias"
  | "padded_local_id"
  | "set_name"
  | "unmatched";

export type PokemonTcgMappingStatus = "matched" | "unmatched";

export interface PokemonTcgCardRef {
  id: string;
  number?: string | null;
  setId?: string | null;
  setName?: string | null;
}

export interface PokemonTcgMapResult {
  pokemontcgCardId: string;
  tcgdexId: string | null;
  tcgdexSetId: string | null;
  localId: string | null;
  status: PokemonTcgMappingStatus;
  method: PokemonTcgMappingMethod;
  unmatchedReason?: string;
}

const KNOWN_SET_PREFIX =
  /^(base|gym|neo|ecard|ex|dp|pl|hgss|bw|xy|sm|swsh|sv|pop|col|basep|si|svp|swshp|mcd|dv|tk|cel|pgo|det1|dv1)/i;

/** pokemontcg.io `sv3pt5` / `swsh12pt5` → TCGdex `sv03.5` / `swsh12.5`. */
export function pokemontcgSetIdToTcgdex(setId: string): string {
  let id = setId.trim().toLowerCase();
  if (!id) return id;
  id = id.replace(/pt5$/, ".5");
  const sv = /^sv(\d+)(\.5)?$/.exec(id);
  if (sv) return `sv${sv[1]!.padStart(2, "0")}${sv[2] ?? ""}`;
  return id;
}

export function parsePokemontcgCardId(id: string): { setId: string; number: string } | null {
  const trimmed = id.trim();
  const idx = trimmed.indexOf("-");
  if (idx <= 0 || idx === trimmed.length - 1) return null;
  return { setId: trimmed.slice(0, idx), number: trimmed.slice(idx + 1) };
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function localIdCandidates(number: string): string[] {
  const raw = number.trim();
  if (!raw) return [];
  const out = [raw];
  if (/^\d+$/.test(raw)) {
    out.push(raw.replace(/^0+/, "") || "0");
    out.push(raw.padStart(3, "0"));
  }
  return unique(out);
}

/** Prefer TCGdex's usual SV padding; keep WotC / SWSH numbers as printed. */
export function preferredLocalId(tcgdexSetId: string, number: string): string {
  const raw = number.trim();
  if (/^sv\d/.test(tcgdexSetId) && /^\d+$/.test(raw)) return raw.padStart(3, "0");
  return raw;
}

export function mapPokemontcgCardToTcgdex(card: PokemonTcgCardRef): PokemonTcgMapResult {
  const pokemontcgCardId = card.id.trim();
  const parsed = parsePokemontcgCardId(pokemontcgCardId);
  if (!parsed) {
    return {
      pokemontcgCardId,
      tcgdexId: null,
      tcgdexSetId: null,
      localId: null,
      status: "unmatched",
      method: "unmatched",
      unmatchedReason: "id_unparseable",
    };
  }

  const number = (card.number?.trim() || parsed.number).trim();
  const rawSetId = (card.setId?.trim() || parsed.setId).trim();
  const aliasedSet = pokemontcgSetIdToTcgdex(rawSetId);
  const namedSet = tcgdexSetIdForName(card.setName) ?? tcgdexSetIdForName(rawSetId);
  const tcgdexSetId = (namedSet && !KNOWN_SET_PREFIX.test(aliasedSet) ? namedSet : aliasedSet) || namedSet || rawSetId.toLowerCase();
  const localId = preferredLocalId(tcgdexSetId, number);

  if (!tcgdexSetId || !localId) {
    return {
      pokemontcgCardId,
      tcgdexId: null,
      tcgdexSetId: tcgdexSetId || null,
      localId: localId || null,
      status: "unmatched",
      method: "unmatched",
      unmatchedReason: "missing_set_or_number",
    };
  }

  if (!KNOWN_SET_PREFIX.test(tcgdexSetId) && !namedSet) {
    return {
      pokemontcgCardId,
      tcgdexId: null,
      tcgdexSetId,
      localId,
      status: "unmatched",
      method: "unmatched",
      unmatchedReason: `unknown_set:${rawSetId}`,
    };
  }

  const tcgdexId = `${tcgdexSetId}-${localId}`;

  if (tcgdexId === pokemontcgCardId) {
    return {
      pokemontcgCardId,
      tcgdexId,
      tcgdexSetId,
      localId,
      status: "matched",
      method: "exact_id",
    };
  }

  if (namedSet && namedSet === tcgdexSetId && aliasedSet !== tcgdexSetId) {
    return {
      pokemontcgCardId,
      tcgdexId,
      tcgdexSetId,
      localId,
      status: "matched",
      method: "set_name",
    };
  }

  if (localId !== number && localId !== parsed.number) {
    return {
      pokemontcgCardId,
      tcgdexId,
      tcgdexSetId,
      localId,
      status: "matched",
      method: "padded_local_id",
    };
  }

  return {
    pokemontcgCardId,
    tcgdexId,
    tcgdexSetId,
    localId,
    status: "matched",
    method: "set_alias",
  };
}
