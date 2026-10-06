const POKEAPI_SPECIES = "https://pokeapi.co/api/v2/pokemon-species?limit=2000";

const NAME_OVERRIDES: Record<string, string> = {
  "nidoran-f": "Nidoran♀",
  "nidoran-m": "Nidoran♂",
  "mr-mime": "Mr. Mime",
  "mr-rime": "Mr. Rime",
  "mime-jr": "Mime Jr.",
  farfetchd: "Farfetch'd",
  sirfetchd: "Sirfetch'd",
  "ho-oh": "Ho-Oh",
  "porygon-z": "Porygon-Z",
  "jangmo-o": "Jangmo-o",
  "hakamo-o": "Hakamo-o",
  "kommo-o": "Kommo-o",
  "type-null": "Type: Null",
  flabebe: "Flabébé",
  "wo-chien": "Wo-Chien",
  "chien-pao": "Chien-Pao",
  "ting-lu": "Ting-Lu",
  "chi-yu": "Chi-Yu",
};

const GENERATION_BANDS: { generation: number; to: number; regions: string[] }[] = [
  { generation: 1, to: 151, regions: ["kanto"] },
  { generation: 2, to: 251, regions: ["johto"] },
  { generation: 3, to: 386, regions: ["hoenn"] },
  { generation: 4, to: 493, regions: ["sinnoh"] },
  { generation: 5, to: 649, regions: ["unova"] },
  { generation: 6, to: 721, regions: ["kalos"] },
  { generation: 7, to: 809, regions: ["alola"] },
  { generation: 8, to: 905, regions: ["galar", "hisui"] },
  { generation: 9, to: Number.POSITIVE_INFINITY, regions: ["paldea"] },
];

export interface DexEntry {
  dexId: number;
  slug: string;
  name: string;
  generation: number;
  regions: string[];
}

let dexCache: DexEntry[] | null = null;
let dexPending: Promise<DexEntry[]> | null = null;

export function displayPokemonName(slug: string): string {
  const override = NAME_OVERRIDES[slug];
  if (override) return override;
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatDexNumber(dexId: number, digits: 3 | 4 = 4): string {
  return `#${String(dexId).padStart(digits, "0")}`;
}

export function firstRouteParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function bandForDexId(dexId: number): { generation: number; regions: string[] } {
  return (
    GENERATION_BANDS.find((band) => dexId <= band.to) ??
    GENERATION_BANDS[GENERATION_BANDS.length - 1]!
  );
}

function dexIdFromSpeciesUrl(url: string): number | null {
  const match = /\/pokemon-species\/(\d+)\/?$/.exec(url);
  if (!match) return null;
  const dexId = Number(match[1]);
  return Number.isFinite(dexId) ? dexId : null;
}

export function matchesDexQuery(entry: DexEntry, raw: string): boolean {
  const query = raw.trim().toLowerCase();
  if (!query) return true;
  if (entry.name.toLowerCase().includes(query)) return true;
  if (entry.regions.some((region) => region.includes(query))) return true;
  const compact = query.replace(/\s+/g, "");
  if (compact === `gen${entry.generation}` || compact === `generation${entry.generation}`) {
    return true;
  }
  const hashed = /^#?0*(\d+)$/.exec(query);
  if (hashed) return entry.dexId === Number(hashed[1]);
  return false;
}

export async function loadNationalDex(): Promise<DexEntry[]> {
  if (dexCache) return dexCache;
  if (dexPending) return dexPending;
  dexPending = fetchNationalDex()
    .then((entries) => {
      dexCache = entries;
      return entries;
    })
    .finally(() => {
      dexPending = null;
    });
  return dexPending;
}

async function fetchNationalDex(): Promise<DexEntry[]> {
  let response: Response;
  try {
    response = await fetch(POKEAPI_SPECIES);
  } catch {
    throw new Error("Could not load the Pokédex.");
  }
  if (!response.ok) throw new Error("Could not load the Pokédex.");
  const payload: unknown = await response.json();
  const results =
    payload && typeof payload === "object" && "results" in payload
      ? (payload as { results?: unknown }).results
      : null;
  if (!Array.isArray(results)) throw new Error("Could not load the Pokédex.");

  const entries: DexEntry[] = [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const slug = "name" in row && typeof row.name === "string" ? row.name : "";
    const url = "url" in row && typeof row.url === "string" ? row.url : "";
    const dexId = dexIdFromSpeciesUrl(url);
    if (!slug || dexId === null) continue;
    const band = bandForDexId(dexId);
    entries.push({
      dexId,
      slug,
      name: displayPokemonName(slug),
      generation: band.generation,
      regions: band.regions,
    });
  }
  entries.sort((left, right) => left.dexId - right.dexId);
  if (entries.length === 0) throw new Error("Could not load the Pokédex.");
  return entries;
}
