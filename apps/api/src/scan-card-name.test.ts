import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { CardCatalogProvider, RgbBitmap, TcgdexCard } from "@cardflow/shared";
import {
  bitmapForOcr,
  cardNameCandidatesFromOcr,
  OCR_MAX_EDGE_PX,
  parseVisionOcrLine,
  printedCollectorNumberFromOcr,
  recognitionFromNamedPrint,
  tcgdexIdFromPrintedOcr,
  VisionOcrSession,
} from "./scan-card-name";

const GWYNN_TEXT = ["SUPPORTER", "Gwynn", "Discard up to 2 cards", "078/084"].join("\n");

function card(partial: Pick<TcgdexCard, "id" | "localId" | "name"> & {
  official: number;
  setId?: string;
}): TcgdexCard {
  return {
    id: partial.id,
    localId: partial.localId,
    name: partial.name,
    image: null,
    category: "Trainer",
    illustrator: null,
    rarity: "Uncommon",
    set: {
      id: partial.setId ?? "me05",
      name: "Pitch Black",
      cardCount: { official: partial.official, total: partial.official },
    },
    variants: { firstEdition: false, holo: false, normal: true, reverse: true, wPromo: false },
    language: "en",
  };
}

describe("card name OCR", () => {
  it("keeps the printed Pokémon name and drops short noise", () => {
    expect(cardNameCandidatesFromOcr("BASS\n'Sizzlipede\nControilied hurs\nBur Ou")).toEqual([
      "Sizzlipede",
      "Controilied",
    ]);
  });

  it("reads a clean name line", () => {
    expect(cardNameCandidatesFromOcr("Sizzlipede\n-80")).toEqual(["Sizzlipede"]);
  });

  it("reads a Supporter title ahead of effect text and keeps 078/084", () => {
    expect(cardNameCandidatesFromOcr(GWYNN_TEXT)[0]).toBe("Gwynn");
    expect(printedCollectorNumberFromOcr(GWYNN_TEXT)).toEqual({
      localId: "78",
      officialCount: 84,
    });
    expect(printedCollectorNumberFromOcr("HP 80")).toBeNull();
  });

  it("picks Gwynn 078/084 among other prints in a 84-card set", async () => {
    const regular = card({ id: "me05-078", localId: "78", name: "Gwynn", official: 84 });
    const fullArt = card({ id: "me05-109", localId: "109", name: "Gwynn", official: 84 });
    const otherSet = card({
      id: "sv1-78",
      localId: "78",
      name: "Other",
      official: 198,
      setId: "sv1",
    });
    const catalog = {
      async listCards() {
        return [fullArt, regular];
      },
      async listSets() {
        return [regular.set, otherSet.set];
      },
      async getCardBySetAndLocalId(setId: string, localId: string) {
        if (setId === "me05" && (localId === "78" || localId === "078")) return regular;
        return null;
      },
    } as unknown as CardCatalogProvider;

    await expect(tcgdexIdFromPrintedOcr(catalog, GWYNN_TEXT)).resolves.toBe("me05-078");
    await expect(
      tcgdexIdFromPrintedOcr(catalog, "Discard up to 2 cards\n078/084"),
    ).resolves.toBe("me05-078");
  });

  it("builds a confirmable recognition for the named print", () => {
    const result = recognitionFromNamedPrint("me05-009", 0.81);
    expect(result.detections[0]?.confidence).toBe("High");
    expect(result.detections[0]?.vendorCardId).toBe("me05-009");
    expect(result.detections[0]?.fields).toContainEqual({ key: "tcgdex_id", value: "me05-009" });
  });

  it("shrinks a large crop for OCR and leaves a small one alone", () => {
    const wide: RgbBitmap = { width: 3200, height: 800, data: new Uint8Array(3200 * 800 * 3) };
    const shrunk = bitmapForOcr(wide);
    expect(Math.max(shrunk.width, shrunk.height)).toBe(OCR_MAX_EDGE_PX);
    expect(shrunk.width).toBeLessThan(wide.width);
    const small: RgbBitmap = { width: 400, height: 560, data: new Uint8Array(400 * 560 * 3) };
    expect(bitmapForOcr(small)).toBe(small);
  });

  it("reads a Vision JSON line", () => {
    expect(parseVisionOcrLine(JSON.stringify({ text: "Pikachu\n078/084" }))).toBe("Pikachu\n078/084");
    expect(parseVisionOcrLine("not-json")).toBe("");
  });
});

describe("persistent Vision OCR", () => {
  it("reuses one process for two crops", async () => {
    let spawns = 0;
    const script = [
      'let buf = "";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", (chunk) => {',
      "  buf += chunk;",
      "  let nl;",
      '  while ((nl = buf.indexOf("\\n")) >= 0) {',
      "    buf = buf.slice(nl + 1);",
      '    process.stdout.write(JSON.stringify({ text: "Pikachu\\n078/084" }) + "\\n");',
      "  }",
      "});",
    ].join("\n");
    const session = new VisionOcrSession("ocr", () => {
      spawns += 1;
      return spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    });
    const png = Uint8Array.from(Array(40).fill(1));
    await expect(session.recognize(png)).resolves.toBe("Pikachu\n078/084");
    await expect(session.recognize(png)).resolves.toBe("Pikachu\n078/084");
    expect(spawns).toBe(1);
    session.stop();
  });
});
