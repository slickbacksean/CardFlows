import { describe, expect, it, vi } from "vitest";
import { CATALOG_UNAVAILABLE_MESSAGE } from "./catalog-flags";
import { confirmIdentity } from "./confirm";
import { createDisabledTcgdexCatalogProvider } from "./catalog";
import { mapRecognitionToCatalog } from "./mapper";
import { identifyCardMock } from "./mock-recognition";
import {
  ciStillBitmap,
  identifyObbPhashBitmap,
  recognitionFromPhashMatches,
} from "./obb-phash";

describe("mapRecognitionToCatalog", () => {
  it("High maps Pikachu on language + set + localId + name without minting an id", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("high-confidence"));
    expect(mapping.status).toBe("matched");
    expect(mapping.confidence).toBe("High");
    expect(mapping.matchedOn).toEqual(["language", "set", "localId", "name"]);
    expect(mapping.tcgdexId).toBe("base1-58");
    expect(mapping.cardsightCardId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(mapping.cardflowCardId).toBeNull();
    expect(mapping.canonicalCard?.cardflowCardId).toBeNull();
    expect(mapping.provider).toBe("mock");
    expect(mapping.userConfirmation.required).toBe(true);
    expect(mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);
  });

  it("does not auto-map Charizard on name alone", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("ambiguous"));
    expect(mapping.status).toBe("ambiguous");
    expect(mapping.confidence).toBe("Medium");
    expect(mapping.tcgdexId).toBeNull();
    expect(mapping.cardflowCardId).toBeNull();
    expect(mapping.candidates.map((card) => card.tcgdexId).sort()).toEqual([
      "base1-4",
      "base4-4",
      "lc-3",
    ]);
    expect(mapping.provider).toBe("mock");
    expect(mapping.userConfirmation.required).toBe(true);
    expect(mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);
  });

  it("returns no_match for an unknown set instead of inventing an id", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("no-match"));
    expect(mapping.status).toBe("no_match");
    expect(mapping.confidence).toBe("Unresolved");
    expect(mapping.tcgdexId).toBeNull();
    expect(mapping.candidates).toEqual([]);
  });

  it("does not map empty detections", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("no-card"));
    expect(mapping.status).toBe("no_match");
    expect(mapping.canonicalCard).toBeNull();
  });

  it("uses the mock catalog provider and never calls the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("mapper tests must not call the network");
    });
    try {
      const mapping = await mapRecognitionToCatalog(identifyCardMock("high-confidence"));
      expect(mapping.provider).toBe("mock");
      expect(mapping.userConfirmation.required).toBe(true);
      expect(mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);
      expect(mapping.cardflowCardId).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("returns FEATURE_DISABLED and search-manually UX when the catalog flag is off", async () => {
    const mapping = await mapRecognitionToCatalog(
      identifyCardMock("high-confidence"),
      createDisabledTcgdexCatalogProvider(),
    );
    expect(mapping.provider).toBe("tcgdex");
    expect(mapping.status).toBe("catalog_unavailable");
    expect(mapping.error).toMatchObject({
      code: "FEATURE_DISABLED",
      retryable: false,
    });
    expect(mapping.tcgdexId).toBeNull();
    expect(mapping.cardflowCardId).toBeNull();
    expect(mapping.userConfirmation.required).toBe(true);
    expect(mapping.userConfirmation.recommendedUx).toMatch(/search/i);
  });

  it("maps an OBB/pHash tcgdex_id through the catalog without inventing or CardSight", async () => {
    const recognition = await identifyObbPhashBitmap(ciStillBitmap("base1-58"));
    const mapping = await mapRecognitionToCatalog(recognition);
    expect(recognition.provider).toBe("obb_phash");
    expect(mapping.tcgdexId).toBe("base1-58");
    expect(mapping.cardsightCardId).toBeNull();
    expect(mapping.status).toBe("matched");
    expect(mapping.confidence).toBe("High");
    expect(mapping.matchedOn).toEqual(["tcgdex_id"]);
    expect(mapping.canonicalCard?.name).toBe("Pikachu");
    expect(mapping.canonicalCard?.set.name).toBe("Base Set");
    expect(mapping.canonicalCard?.localId).toBe("58");
    expect(mapping.canonicalCard?.image.constructedUrl).toContain("assets.tcgdex.net");
    expect(mapping.cardflowCardId).toBeNull();
    expect(mapping.userConfirmation.required).toBe(true);
    expect(JSON.stringify(mapping)).not.toMatch(/api[_ -]?key/i);
    expect(JSON.stringify(mapping)).not.toMatch(/A1_\d+_EN|tcg-pocket/i);

    const unknown = recognitionFromPhashMatches([
      { tcgdexId: "xy99-1", distance: 0, confidence: "High" },
    ]);
    const missed = await mapRecognitionToCatalog(unknown);
    expect(missed.status).toBe("no_match");
    expect(missed.tcgdexId).toBeNull();
    expect(missed.candidates).toEqual([]);
  });
});

describe("confirmIdentity", () => {
  it("mints cardflow_card_id only on confirm", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("high-confidence"));
    const confirmed = confirmIdentity({
      mapping,
      selectedTcgdexId: "base1-58",
      createId: () => "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58",
    });
    expect(confirmed.mintedCardflowCardId).toBe(true);
    expect(confirmed.canonicalCard.cardflowCardId).toBe(
      "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58",
    );
    expect(confirmed.canonicalCard.mintedOn).toBe("confirm");
    expect(confirmed.matchMethod).toBe("identify");
  });

  it("reuses an existing canonical id for the same fingerprint", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("high-confidence"));
    const confirmed = confirmIdentity({
      mapping,
      selectedTcgdexId: "base1-58",
      existingCardflowCardId: "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58",
    });
    expect(confirmed.mintedCardflowCardId).toBe(false);
    expect(confirmed.canonicalCard.cardflowCardId).toBe(
      "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58",
    );
  });

  it("caches the provided catalog snapshot and keeps cardflow_card_id on refresh", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("high-confidence"));
    const first = confirmIdentity({
      mapping,
      selectedTcgdexId: "base1-58",
      createId: () => "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58",
    });
    const refreshed = confirmIdentity({
      mapping,
      selectedTcgdexId: "base1-58",
      existingCardflowCardId: first.canonicalCard.cardflowCardId,
      catalogCard: {
        ...first.canonicalCard,
        name: "Pikachu refreshed",
        localId: "58",
        set: { ...first.canonicalCard.set, name: "Base Set (cached)" },
        variants: { ...first.canonicalCard.variants, reverse: true },
      },
    });
    expect(refreshed.mintedCardflowCardId).toBe(false);
    expect(refreshed.canonicalCard.cardflowCardId).toBe(first.canonicalCard.cardflowCardId);
    expect(refreshed.canonicalCard.name).toBe("Pikachu refreshed");
    expect(refreshed.canonicalCard.set.name).toBe("Base Set (cached)");
    expect(refreshed.canonicalCard.localId).toBe("58");
    expect(refreshed.canonicalCard.variants.reverse).toBe(true);
    expect(refreshed.canonicalCard.image.source).toBe("tcgdex_assets");
    expect(refreshed.canonicalCard.image.constructedUrl).toContain("assets.tcgdex.net");
  });

  it("confirms a searched tcgdexId when mapping is empty", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("no-match"));
    expect(mapping.candidates).toEqual([]);
    expect(mapping.tcgdexId).toBeNull();
    const confirmed = confirmIdentity({
      mapping,
      selectedTcgdexId: "base1-58",
      allowMockCatalog: true,
    });
    expect(confirmed.matchMethod).toBe("manual");
    expect(confirmed.canonicalCard.tcgdexId).toBe("base1-58");
    expect(confirmed.canonicalCard.mintedOn).toBe("confirm");
    expect(confirmed.confirmationRequiredHonored).toBe(true);
  });

  it("does not invent a catalog card when lookup missed", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("no-match"));
    expect(() =>
      confirmIdentity({
        mapping,
        selectedTcgdexId: "not-a-real-id",
        catalogCard: null,
      }),
    ).toThrow(/unknown tcgdexId/);
  });

  it("does not look up MOCK_CARDS when the live catalog snapshot is missing", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("no-match"));
    expect(() =>
      confirmIdentity({
        mapping,
        selectedTcgdexId: "base1-58",
      }),
    ).toThrow(CATALOG_UNAVAILABLE_MESSAGE);
  });
});
