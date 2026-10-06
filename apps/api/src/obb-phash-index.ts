import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeEnglishTcgdexId,
  parsePhashIndex,
  rgbPerceptualHash,
  TCGDEX_PUBLIC_ENDPOINT,
  type PhashIndex,
  type PhashIndexEntry,
  type RecognitionImageMimeType,
  type StillImageDecoder,
} from "@cardflow/shared";

const apiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const TCGDEX_ENGLISH_CARDS_URL = `${TCGDEX_PUBLIC_ENDPOINT}/en/cards`;
export const TCGDEX_ASSETS_HOST = "assets.tcgdex.net";
export const DEFAULT_ENGLISH_PHASH_INDEX_RELATIVE = "data/phash-index.json";
export const DEFAULT_ENGLISH_PHASH_INDEX_PATH = path.join(
  apiRoot,
  DEFAULT_ENGLISH_PHASH_INDEX_RELATIVE,
);

export interface TcgdexArtBrief {
  tcgdexId: string;
  image: string;
}

export interface BuildEnglishPhashIndexOptions {
  decode: StillImageDecoder;
  fetchArt: (url: string) => Promise<Uint8Array | null>;
  existing?: PhashIndex;
  concurrency?: number;
  limit?: number;
  checkpointEvery?: number;
  onProgress?: (done: number, total: number, entry: PhashIndexEntry | null) => void;
  onCheckpoint?: (index: PhashIndex) => void;
}

/**
 * English physical TCG art on assets.tcgdex.net. Pocket `/tcgp/` paths are not catalog art.
 */
export function isEnglishPhysicalTcgdexArtUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname !== TCGDEX_ASSETS_HOST) return false;
  if (!parsed.pathname.startsWith("/en/")) return false;
  if (/\/tcgp\//i.test(parsed.pathname)) return false;
  return true;
}

/** PNG/JPEG only — Capture decode has no WebP. low.* is enough for 24×24 pHash. */
export function tcgdexArtCandidateUrls(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/+$/, "");
  return [`${base}/low.jpg`, `${base}/low.png`, `${base}/high.jpg`, `${base}/high.png`];
}

export function englishPhysicalTcgdexArtBriefs(rows: unknown[]): TcgdexArtBrief[] {
  const unique = new Map<string, TcgdexArtBrief>();
  for (const row of rows) {
    const record = row as { id?: unknown; image?: unknown };
    const tcgdexId = normalizeEnglishTcgdexId(typeof record.id === "string" ? record.id : null);
    const image = typeof record.image === "string" ? record.image.trim() : "";
    if (!tcgdexId || !image || !isEnglishPhysicalTcgdexArtUrl(image)) continue;
    if (!unique.has(tcgdexId)) unique.set(tcgdexId, { tcgdexId, image });
  }
  return [...unique.values()];
}

export function resolvePhashIndexPath(pathName: string): string | undefined {
  const candidates = path.isAbsolute(pathName)
    ? [pathName]
    : [
        path.resolve(pathName),
        path.resolve(apiRoot, pathName),
        path.resolve(apiRoot, "../..", pathName),
      ];
  return candidates.find((candidate) => existsSync(candidate));
}

export function serializePhashIndex(index: PhashIndex): string {
  const parsed = parsePhashIndex(index);
  return `${JSON.stringify(
    {
      _meta: {
        source: "tcgdex_english_art",
        language: "en",
        mocked: false,
      },
      language: "en",
      entries: parsed.entries.map((entry) => ({ tcgdexId: entry.tcgdexId, hash: entry.hash })),
    },
    null,
    2,
  )}\n`;
}

export function writePhashIndexFile(filePath: string, index: PhashIndex): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, serializePhashIndex(index), "utf8");
}

export async function fetchEnglishTcgdexCardRows(
  fetchImpl: typeof fetch = fetch,
): Promise<unknown[]> {
  const response = await fetchImpl(TCGDEX_ENGLISH_CARDS_URL);
  if (!response.ok) {
    throw new Error(`TCGdex English cards list failed: ${response.status}`);
  }
  const rows: unknown = await response.json();
  return Array.isArray(rows) ? rows : [];
}

export function mimeFromArtBytes(
  url: string,
  bytes: Uint8Array,
): RecognitionImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (/\.jpe?g$/i.test(url)) return "image/jpeg";
  if (/\.png$/i.test(url)) return "image/png";
  return null;
}

export async function hashTcgdexArtBrief(
  brief: TcgdexArtBrief,
  options: Pick<BuildEnglishPhashIndexOptions, "decode" | "fetchArt">,
): Promise<PhashIndexEntry | null> {
  for (const url of tcgdexArtCandidateUrls(brief.image)) {
    const bytes = await options.fetchArt(url);
    if (!bytes || bytes.byteLength === 0) continue;
    const mime = mimeFromArtBytes(url, bytes);
    if (!mime) continue;
    const bitmap = await options.decode(bytes, mime);
    if (!bitmap || bitmap.width < 1 || bitmap.height < 1) continue;
    return { tcgdexId: brief.tcgdexId, hash: rgbPerceptualHash(bitmap) };
  }
  return null;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  }
  const count = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: count }, () => worker()));
  return results;
}

/**
 * Hash TCGdex English physical art into `{ tcgdexId, hash }`.
 * Does not download Pocket `/tcgp/` images. Callers persist to a gitignored JSON.
 */
export async function buildEnglishPhashIndex(
  briefs: TcgdexArtBrief[],
  options: BuildEnglishPhashIndexOptions,
): Promise<PhashIndex> {
  const existing = parsePhashIndex(options.existing ?? { language: "en", entries: [] });
  const known = new Map(existing.entries.map((entry) => [entry.tcgdexId, entry]));
  const pending = briefs.filter((brief) => !known.has(brief.tcgdexId));
  const limited = options.limit != null ? pending.slice(0, Math.max(0, options.limit)) : pending;
  const concurrency = Math.max(1, options.concurrency ?? 6);
  const checkpointEvery = Math.max(1, options.checkpointEvery ?? 50);
  function snapshot(): PhashIndex {
    return {
      language: "en",
      entries: [...known.values()].sort((left, right) => left.tcgdexId.localeCompare(right.tcgdexId)),
    };
  }
  let completed = 0;
  await mapPool(limited, concurrency, async (brief) => {
    const entry = await hashTcgdexArtBrief(brief, options);
    if (entry) known.set(entry.tcgdexId, entry);
    completed += 1;
    const done = completed;
    options.onProgress?.(done, limited.length, entry);
    if (done === limited.length || done % checkpointEvery === 0) {
      options.onCheckpoint?.(snapshot());
    }
    return entry;
  });
  return snapshot();
}
