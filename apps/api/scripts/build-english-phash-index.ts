/**
 * Local-only English TCGdex pHash index. Not run in CI.
 *
 *   pnpm --filter @cardflow/api build:phash-index
 *
 * Writes gitignored apps/api/data/phash-index.json from assets.tcgdex.net English art.
 * Pocket /tcgp/ URLs and A1/B1 ids are skipped. Tests keep the tiny fixture.
 */
import { parsePhashIndex } from "@cardflow/shared";
import { existsSync, readFileSync } from "node:fs";
import { decodeScanStill } from "../src/obb-phash-decode";
import {
  buildEnglishPhashIndex,
  DEFAULT_ENGLISH_PHASH_INDEX_PATH,
  englishPhysicalTcgdexArtBriefs,
  fetchEnglishTcgdexCardRows,
  writePhashIndexFile,
} from "../src/obb-phash-index";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function argNumber(flag: string, fallback: number): number {
  const raw = argValue(flag);
  if (raw == undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchArt(url: string): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 404 || response.status === 410) return null;
      if (response.status === 429 || response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.byteLength > 0 ? bytes : null;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  return null;
}

async function main() {
  const out = argValue("--out") ?? DEFAULT_ENGLISH_PHASH_INDEX_PATH;
  const limitRaw = argValue("--limit");
  const parsedLimit = limitRaw == undefined ? undefined : Number(limitRaw);
  const limit = parsedLimit != null && Number.isFinite(parsedLimit) ? parsedLimit : undefined;
  const concurrency = argNumber("--concurrency", 6);
  const existing = existsSync(out)
    ? parsePhashIndex(JSON.parse(readFileSync(out, "utf8")))
    : undefined;
  const rows = await fetchEnglishTcgdexCardRows();
  const briefs = englishPhysicalTcgdexArtBriefs(rows);
  console.log(
    `TCGdex English physical art: ${briefs.length} ids (list ${rows.length}). Writing ${out}`,
  );
  const index = await buildEnglishPhashIndex(briefs, {
    decode: decodeScanStill,
    fetchArt,
    existing,
    concurrency,
    limit,
    onProgress(done, total) {
      if (done === total || done % 50 === 0) {
        console.log(`hashed ${done}/${total} this run`);
      }
    },
    onCheckpoint(partial) {
      writePhashIndexFile(out, partial);
    },
  });
  writePhashIndexFile(out, index);
  console.log(`Wrote ${index.entries.length} English tcgdex_id hashes to ${out}`);
}

await main();
