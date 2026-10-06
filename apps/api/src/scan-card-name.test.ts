import { describe, expect, it } from "vitest";
import type { CardCatalogProvider, TcgdexCard } from "@cardflow/shared";
import {
  cardNameCandidatesFromOcr,
  printedCollectorNumberFromOcr,
  recognitionFromNamedPrint,
  tcgdexIdFromPrintedOcr,
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
});
