import { File, Paths } from "expo-file-system";
import {
  emptyCatalogSnapshot,
  mergeIntoSnapshot,
  parseCatalogSnapshot,
  searchCatalogSnapshot,
  type CardFlowCanonicalCard,
  type CatalogSnapshot,
} from "@cardflow/shared";
import { searchCatalog } from "./api";

/** P1-04: on-phone catalog snapshot (cards seen in search/scans) for offline search. */
export const CATALOG_OFFLINE_NOTICE = "Offline. Showing cards saved on this phone." as const;

const FILE_NAME = "catalog-snapshot-v1.json";
let memory: CatalogSnapshot | null = null;

function snapshotFile() {
  return new File(Paths.document, FILE_NAME);
}

export async function loadCatalogSnapshot(): Promise<CatalogSnapshot> {
  if (memory) return memory;
  try {
    const file = snapshotFile();
    memory = file.exists ? (parseCatalogSnapshot(await file.text()) ?? emptyCatalogSnapshot()) : emptyCatalogSnapshot();
  } catch {
    memory = emptyCatalogSnapshot();
  }
  return memory;
}

export async function rememberCatalogCards(cards: readonly CardFlowCanonicalCard[]): Promise<void> {
  if (cards.length === 0) return;
  try {
    memory = mergeIntoSnapshot(await loadCatalogSnapshot(), cards);
    snapshotFile().write(JSON.stringify(memory));
  } catch {
    // The snapshot is a convenience; never block the flow on disk errors.
  }
}

type SearchInput = Parameters<typeof searchCatalog>[0];
type SearchResult = Awaited<ReturnType<typeof searchCatalog>>;

/** Network search that saves results, and falls back to the snapshot when offline. */
export async function searchCatalogWithSnapshot(input: SearchInput): Promise<SearchResult> {
  try {
    const result = await searchCatalog(input);
    void rememberCatalogCards(result.cards);
    return result;
  } catch (error) {
    const cards = searchCatalogSnapshot(await loadCatalogSnapshot(), input);
    if (cards.length === 0) throw error;
    return {
      ok: true,
      provider: "tcgdex",
      language: "en",
      query: { set: input.set ?? null, number: input.number ?? null, name: input.name ?? null },
      userConfirmationRequired: true,
      autoConfirm: false,
      nameOnly: Boolean(input.name && !input.set && !input.number),
      cards,
      cached: true,
      notice: CATALOG_OFFLINE_NOTICE,
      error: null,
    };
  }
}
