import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  identifyObbPhashBitmap,
  rgbPerceptualHash,
  RGB_PHASH_BITS,
  type RgbBitmap,
} from "@cardflow/shared";
import { decodeScanStill, encodePngStill } from "./obb-phash-decode";
import {
  buildEnglishPhashIndex,
  DEFAULT_ENGLISH_PHASH_INDEX_PATH,
  englishPhysicalTcgdexArtBriefs,
  fetchEnglishTcgdexCardRows,
  isEnglishPhysicalTcgdexArtUrl,
  mimeFromArtBytes,
  resolvePhashIndexPath,
  serializePhashIndex,
  tcgdexArtCandidateUrls,
  TCGDEX_ENGLISH_CARDS_URL,
  writePhashIndexFile,
} from "./obb-phash-index";
import { createApiObbPhashProvider } from "./obb-phash-provider";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function fillRgb(width: number, height: number, color: readonly [number, number, number]): RgbBitmap {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = color[0];
    data[i * 3 + 1] = color[1];
    data[i * 3 + 2] = color[2];
  }
  return { width, height, data };
}

describe("English TCGdex pHash index builder", () => {
  it("keeps only English physical art URLs and skips Pocket /tcgp/ ids", () => {
    expect(isEnglishPhysicalTcgdexArtUrl("https://assets.tcgdex.net/en/base/base1/58")).toBe(true);
    expect(isEnglishPhysicalTcgdexArtUrl("https://assets.tcgdex.net/en/swsh/swsh3/136")).toBe(true);
    expect(isEnglishPhysicalTcgdexArtUrl("https://assets.tcgdex.net/en/tcgp/A1/001")).toBe(false);
    expect(isEnglishPhysicalTcgdexArtUrl("https://assets.tcgdex.net/en/tcgp/B1/001")).toBe(false);
    expect(isEnglishPhysicalTcgdexArtUrl("https://pocket.example/A1.json")).toBe(false);
    expect(tcgdexArtCandidateUrls("https://assets.tcgdex.net/en/base/base1/58")).toEqual([
      "https://assets.tcgdex.net/en/base/base1/58/low.jpg",
      "https://assets.tcgdex.net/en/base/base1/58/low.png",
      "https://assets.tcgdex.net/en/base/base1/58/high.jpg",
      "https://assets.tcgdex.net/en/base/base1/58/high.png",
    ]);

    const briefs = englishPhysicalTcgdexArtBriefs([
      { id: "base1-58", image: "https://assets.tcgdex.net/en/base/base1/58" },
      { id: "base1-4", image: "https://assets.tcgdex.net/en/base/base1/4" },
      { id: "swsh3-136", image: "https://assets.tcgdex.net/en/swsh/swsh3/136" },
      { id: "A1-001", image: "https://assets.tcgdex.net/en/tcgp/A1/001" },
      { id: "B1-001", image: "https://assets.tcgdex.net/en/tcgp/B1/001" },
      { id: "sv01-1", image: "https://assets.tcgdex.net/en/tcgp/sv01/1" },
      { id: "missing-art", image: null },
    ]);
    expect(briefs.map((brief) => brief.tcgdexId).sort()).toEqual([
      "base1-4",
      "base1-58",
      "swsh3-136",
    ]);
  });

  it("hashes mocked TCGdex art for more than the two CI fixture ids", async () => {
    const art = {
      "base1-58": encodePngStill(fillRgb(24, 32, [255, 214, 0])),
      "base1-4": encodePngStill(fillRgb(24, 32, [196, 36, 28])),
      "swsh3-136": encodePngStill(fillRgb(24, 32, [40, 90, 200])),
    } as const;
    const fetched: string[] = [];
    const index = await buildEnglishPhashIndex(
      englishPhysicalTcgdexArtBriefs([
        { id: "base1-58", image: "https://assets.tcgdex.net/en/base/base1/58" },
        { id: "base1-4", image: "https://assets.tcgdex.net/en/base/base1/4" },
        { id: "swsh3-136", image: "https://assets.tcgdex.net/en/swsh/swsh3/136" },
        { id: "A1-001", image: "https://assets.tcgdex.net/en/tcgp/A1/001" },
      ]),
      {
        decode: decodeScanStill,
        existing: {
          language: "en",
          entries: [{ tcgdexId: "base1-58", hash: "0".repeat(RGB_PHASH_BITS) }],
        },
        async fetchArt(url) {
          fetched.push(url);
          const id = url.includes("/swsh3/")
            ? "swsh3-136"
            : url.includes("/base1/4")
              ? "base1-4"
              : "base1-58";
          return art[id];
        },
      },
    );
    expect(index.language).toBe("en");
    expect(index.entries.map((entry) => entry.tcgdexId)).toEqual([
      "base1-4",
      "base1-58",
      "swsh3-136",
    ]);
    expect(index.entries.every((entry) => entry.hash.length === RGB_PHASH_BITS)).toBe(true);
    expect(fetched.every((url) => url.startsWith("https://assets.tcgdex.net/en/"))).toBe(true);
    expect(fetched.join("\n")).not.toMatch(/tcgp|A1-001|tcg-pocket|\/base1\/58/i);

    const serialized = serializePhashIndex(index);
    expect(serialized).toContain('"mocked": false');
    expect(serialized).toContain("tcgdex_english_art");
    expect(serialized).not.toMatch(/A1-001|B1-001|tcg-pocket|P-A\.json/i);

    const matched = await identifyObbPhashBitmap(fillRgb(24, 32, [40, 90, 200]), { index });
    expect(matched.detections[0]?.vendorCardId).toBe("swsh3-136");
    expect(matched.detections.map((row) => row.vendorCardId)).not.toEqual(["base1-58"]);
  });

  it("lists English cards from the public TCGdex endpoint, not Pocket dumps", async () => {
    const urls: string[] = [];
    const rows = await fetchEnglishTcgdexCardRows(async (input) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify([
          { id: "base1-58", image: "https://assets.tcgdex.net/en/base/base1/58" },
          { id: "A1-001", image: "https://assets.tcgdex.net/en/tcgp/A1/001" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    expect(urls).toEqual([TCGDEX_ENGLISH_CARDS_URL]);
    expect(TCGDEX_ENGLISH_CARDS_URL).toBe("https://api.tcgdex.net/v2/en/cards");
    expect(englishPhysicalTcgdexArtBriefs(rows).map((brief) => brief.tcgdexId)).toEqual(["base1-58"]);
  });

  it("resolves and loads a gitignored index path without changing the CI fixture", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cardflow-phash-"));
    const filePath = path.join(dir, "phash-index.json");
    try {
      const bitmap = fillRgb(16, 16, [12, 80, 200]);
      writePhashIndexFile(filePath, {
        language: "en",
        entries: [
          { tcgdexId: "base1-58", hash: "0".repeat(RGB_PHASH_BITS) },
          { tcgdexId: "base1-4", hash: "1".repeat(RGB_PHASH_BITS) },
          { tcgdexId: "swsh3-136", hash: rgbPerceptualHash(bitmap) },
          { tcgdexId: "A1-001", hash: "1".repeat(RGB_PHASH_BITS) },
        ],
      });
      expect(resolvePhashIndexPath(filePath)).toBe(filePath);
      expect(resolvePhashIndexPath("/tmp/cardflow-missing-phash-index.json")).toBeUndefined();
      expect(DEFAULT_ENGLISH_PHASH_INDEX_PATH).toContain(`${path.sep}data${path.sep}phash-index.json`);
      expect(readFileSync(path.join(repoRoot, ".gitignore"), "utf8")).toMatch(
        /apps\/api\/data\/phash-index\.json|apps\/api\/data\//,
      );

      const provider = createApiObbPhashProvider({
        CARD_FLOW_OBB_PHASH_INDEX: filePath,
      });
      const png = encodePngStill(bitmap);
      const result = await provider.identifyCard({ image: png, mimeType: "image/png" });
      expect(result.provider).toBe("obb_phash");
      expect(result.detections[0]?.vendorCardId).toBe("swsh3-136");
      expect(JSON.stringify(result)).not.toMatch(/A1-001|tcg-pocket|cardsight\.ai/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not ship the generator in CI and never vendors Pocket blobs", () => {
    const script = readFileSync(
      path.join(repoRoot, "apps/api/scripts/build-english-phash-index.ts"),
      "utf8",
    );
    const builder = readFileSync(path.join(repoRoot, "apps/api/src/obb-phash-index.ts"), "utf8");
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "apps/api/package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const rootPkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build:phash-index"]).toContain("build-english-phash-index.ts");
    expect(pkg.scripts.test).not.toContain("build:phash-index");
    expect(rootPkg.scripts.test).not.toContain("build:phash-index");
    expect(script).toContain("Not run in CI");
    expect(script).toContain("assets.tcgdex.net");
    expect(builder).toContain("/tcgp/");
    expect(builder).not.toMatch(/src\/assets\/cards\/A1\.json|IndexedDB|tcg-pocket/i);
    expect(script).not.toMatch(/src\/assets\/cards\/A1\.json|Pokemon-TCGP|view-shot/i);
    expect(mimeFromArtBytes("https://example/a.jpg", new Uint8Array([0xff, 0xd8, 0xff]))).toBe(
      "image/jpeg",
    );
    expect(mimeFromArtBytes("https://example/a.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
      "image/png",
    );
    expect(mimeFromArtBytes("https://example/a.webp", new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull();
  });
});
