/**
 * P1-04: curated set-name → TCGdex set-ID table.
 * Keys are normalized (see normalizeSetName). Add vendor spellings as aliases here;
 * anything unmapped is reported by the API (`logUnmappedSetName`) so it can be added.
 */
const SETS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["base1", ["Base Set", "Base", "Base Set Unlimited", "Base Set 1st Edition", "Base Set Shadowless"]],
  ["base2", ["Jungle"]],
  ["base3", ["Fossil"]],
  ["base4", ["Base Set 2", "Base 2"]],
  ["base5", ["Team Rocket"]],
  ["lc", ["Legendary Collection"]],
  ["gym1", ["Gym Heroes"]],
  ["gym2", ["Gym Challenge"]],
  ["neo1", ["Neo Genesis"]],
  ["neo2", ["Neo Discovery"]],
  ["neo3", ["Neo Revelation"]],
  ["neo4", ["Neo Destiny"]],
  ["ecard1", ["Expedition Base Set", "Expedition"]],
  ["basep", ["Wizards Black Star Promos", "WotC Black Star Promos", "Wizards Promos"]],
  ["cel25", ["Celebrations"]],
  ["swsh1", ["Sword & Shield", "Sword and Shield", "Sword & Shield Base Set", "SWSH Base"]],
  ["swsh2", ["Rebel Clash"]],
  ["swsh3", ["Darkness Ablaze"]],
  ["swsh3.5", ["Champion's Path", "Champions Path"]],
  ["swsh4", ["Vivid Voltage"]],
  ["swsh4.5", ["Shining Fates"]],
  ["swsh5", ["Battle Styles"]],
  ["swsh6", ["Chilling Reign"]],
  ["swsh7", ["Evolving Skies"]],
  ["swsh8", ["Fusion Strike"]],
  ["swsh9", ["Brilliant Stars"]],
  ["swsh10", ["Astral Radiance"]],
  ["swsh10.5", ["Pokémon GO", "Pokemon GO"]],
  ["swsh11", ["Lost Origin"]],
  ["swsh12", ["Silver Tempest"]],
  ["swsh12.5", ["Crown Zenith"]],
  ["swshp", ["SWSH Black Star Promos", "Sword & Shield Promos", "Sword and Shield Black Star Promos"]],
  ["sv01", ["Scarlet & Violet", "Scarlet and Violet", "Scarlet & Violet Base Set", "SV Base"]],
  ["sv02", ["Paldea Evolved"]],
  ["sv03", ["Obsidian Flames"]],
  ["sv03.5", ["151", "Scarlet & Violet 151", "Pokémon 151", "Pokemon 151", "SV 151"]],
  ["sv04", ["Paradox Rift"]],
  ["sv04.5", ["Paldean Fates"]],
  ["sv05", ["Temporal Forces"]],
  ["sv06", ["Twilight Masquerade"]],
  ["sv06.5", ["Shrouded Fable"]],
  ["sv07", ["Stellar Crown"]],
  ["sv08", ["Surging Sparks"]],
  ["sv08.5", ["Prismatic Evolutions"]],
  ["svp", ["SVP Black Star Promos", "SV Black Star Promos", "Scarlet & Violet Promos", "Scarlet and Violet Black Star Promos"]],
];

export function normalizeSetName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/^(pokemon tcg|pokemon)\s*[:\-]?\s*/, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export const SET_NAME_TO_TCGDEX_ID: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [id, names] of SETS) {
    map.set(normalizeSetName(id), id);
    for (const name of names) map.set(normalizeSetName(name), id);
  }
  return map;
})();

/** Returns the TCGdex set ID for a vendor set name or ID, or null when unmapped. */
export function tcgdexSetIdForName(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  return SET_NAME_TO_TCGDEX_ID.get(normalizeSetName(name)) ?? null;
}

export interface UnmappedSetNameReport {
  setName: string;
  source: string;
  /** Set the live catalog found by name search, if any (candidate for the table). */
  catalogSetId: string | null;
}

let unmappedReporter: ((report: UnmappedSetNameReport) => void) | null = null;

/** The API registers a logger here; shared code calls reportUnmappedSetName on table misses. */
export function setUnmappedSetNameReporter(fn: ((report: UnmappedSetNameReport) => void) | null): void {
  unmappedReporter = fn;
}

export function reportUnmappedSetName(report: UnmappedSetNameReport): void {
  unmappedReporter?.(report);
}
