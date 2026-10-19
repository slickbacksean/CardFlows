import { describe, expect, it } from "vitest";
import {
  ENGLISH_CARDS_ONLY_NOTE,
  isEnglishCardLanguage,
  isUnsupportedCardLanguage,
} from "./english-cards";
import { mapRecognitionToCatalog } from "./mapper";
import type { CardFlowNormalizedRecognitionResult } from "./types";

const jaRecognition: CardFlowNormalizedRecognitionResult = {
  provider: "mock",
  ok: true,
  vendorRequestId: "req_ja",
  processingTimeMs: 10,
  detections: [
    {
      confidence: "High",
      matchLevel: "exact",
      vendorCardId: "ja-card-1",
      name: "ピカチュウ",
      setName: "Base Set",
      number: "58",
      language: "ja",
      fields: [{ key: "CARD_LANGUAGE", value: "ja" }],
      candidates: [],
    },
  ],
  error: null,
};

describe("English-only cards (Sean Oct 18)", () => {
  it("treats missing language as English and flags ja", () => {
    expect(isEnglishCardLanguage(null)).toBe(true);
    expect(isEnglishCardLanguage("en")).toBe(true);
    expect(isUnsupportedCardLanguage("ja")).toBe(true);
    expect(isUnsupportedCardLanguage("en")).toBe(false);
    expect(ENGLISH_CARDS_ONLY_NOTE).toBe("Only English cards are supported for now.");
  });

  it("does not map a Japanese CardSight detection", async () => {
    const mapping = await mapRecognitionToCatalog(jaRecognition);
    expect(mapping.status).toBe("no_match");
    expect(mapping.canonicalCard).toBeNull();
    expect(mapping.tcgdexId).toBeNull();
    expect(mapping.userConfirmation.recommendedUx).toBe(ENGLISH_CARDS_ONLY_NOTE);
    expect(mapping.lookup.method).toContain("language is not en");
  });
});
