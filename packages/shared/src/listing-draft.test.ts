import { describe, expect, it } from "vitest";
import {
  appendSnippet,
  buildClipboardExport,
  canMarkReadyForReview,
  computeCostToAskSpread,
  descriptionStarter,
  DISCLOSURE_ITEMS,
  disclosureSnippet,
  GRADING_PILLARS,
  keywordChips,
  LISTING_AI_COPY_ENABLED,
  listPurchasedDraftsForCopy,
  readyForReviewMissing,
  renderListingTitle,
  selectCopyListingDraft,
  type CopyListingInventoryItem,
} from "./listing-draft";

const pikachu = {
  name: "Pikachu",
  setName: "Base Set",
  localId: "58",
  selectedVariant: "normal",
  condition: "NM",
};

describe("listing titles", () => {
  it("renders the default identity template", () => {
    expect(renderListingTitle(pikachu)).toBe("Pikachu - Base Set #58 [normal] EN");
  });

  it("falls back to Raw when variant is missing", () => {
    expect(
      renderListingTitle({ ...pikachu, selectedVariant: null }),
    ).toBe("Pikachu - Base Set #58 [Raw] EN");
  });

  it("optionally appends condition", () => {
    expect(
      renderListingTitle(pikachu, "en_raw_single_with_condition"),
    ).toBe("Pikachu - Base Set #58 [normal] EN NM");
  });
});

describe("description and keywords", () => {
  it("builds a catalog starter, not sell-spam", () => {
    expect(descriptionStarter(pikachu)).toBe(
      "Pikachu — Base Set #58 — English — normal (Raw)\nCondition: NM",
    );
  });

  it("offers chips that copy into description, with no keywords column", () => {
    expect(keywordChips(pikachu)).toEqual([
      "Pikachu",
      "Base Set",
      "58",
      "raw",
      "English",
      "normal",
    ]);
  });
});

describe("spread", () => {
  it("computes asking vs all-in as spread, never profit", () => {
    const spread = computeCostToAskSpread({
      askingPrice: "9.00",
      allInTotal: "4.04",
      currency: "USD",
    });
    expect(spread?.spread).toBe("4.96");
    expect(spread?.label).toBe("spread / cost-to-ask gap");
    expect(spread?.neverLabelAsProfit).toBe(true);
    expect(spread?.display).not.toMatch(/profit/i);
  });

  it("does not invent a spread without an asking price", () => {
    expect(
      computeCostToAskSpread({ askingPrice: null, allInTotal: "4.04" }),
    ).toBeNull();
  });
});

describe("copy listing routing", () => {
  function item(
    overrides: Partial<CopyListingInventoryItem> & Pick<CopyListingInventoryItem, "intent">,
  ): CopyListingInventoryItem {
    return {
      createdAt: "2026-09-14T12:00:00.000Z",
      draft: null,
      ...overrides,
    };
  }

  it("returns null when nothing purchased has a draft", () => {
    expect(selectCopyListingDraft([])).toBeNull();
    expect(
      selectCopyListingDraft([
        item({ intent: "purchased" }),
        item({
          intent: "watchlist",
          createdAt: "2026-09-14T13:00:00.000Z",
          draft: { draftId: "watch-1", status: "draft" },
        }),
      ]),
    ).toBeNull();
  });

  it("opens a purchased draft and ignores watchlist copies", () => {
    expect(
      selectCopyListingDraft([
        item({
          intent: "watchlist",
          createdAt: "2026-09-14T14:00:00.000Z",
          draft: { draftId: "watch-1", status: "ready_for_review" },
        }),
        item({
          intent: "purchased",
          draft: { draftId: "buy-1", status: "draft" },
        }),
      ]),
    ).toEqual({ draftId: "buy-1", status: "draft" });
  });

  it("prefers ready_for_review over a newer purchased draft", () => {
    expect(
      selectCopyListingDraft([
        item({
          intent: "purchased",
          createdAt: "2026-09-14T15:00:00.000Z",
          draft: { draftId: "newer-draft", status: "draft" },
        }),
        item({
          intent: "purchased",
          createdAt: "2026-09-14T10:00:00.000Z",
          draft: { draftId: "ready-draft", status: "ready_for_review" },
        }),
      ]),
    ).toEqual({ draftId: "ready-draft", status: "ready_for_review" });
  });

  it("falls back to the most recent purchased draft", () => {
    expect(
      selectCopyListingDraft([
        item({
          intent: "purchased",
          createdAt: "2026-09-14T09:00:00.000Z",
          draft: { draftId: "older", status: "draft" },
        }),
        item({
          intent: "purchased",
          createdAt: "2026-09-14T11:00:00.000Z",
          draft: { draftId: "newer", status: "draft" },
        }),
      ]),
    ).toEqual({ draftId: "newer", status: "draft" });
  });

  it("lists every purchased draft and omits watchlist copies", () => {
    expect(listPurchasedDraftsForCopy([])).toEqual([]);
    expect(
      listPurchasedDraftsForCopy([
        item({
          intent: "watchlist",
          createdAt: "2026-09-14T16:00:00.000Z",
          draft: { draftId: "watch-1", status: "ready_for_review", title: "Watch me" },
          card: { name: "Watchlist Pikachu" },
        }),
        item({ intent: "purchased", card: { name: "No draft Charizard" } }),
        item({
          intent: "purchased",
          createdAt: "2026-09-14T09:00:00.000Z",
          draft: { draftId: "older", status: "draft" },
          card: { name: "Charizard" },
        }),
        item({
          intent: "purchased",
          createdAt: "2026-09-14T11:00:00.000Z",
          draft: {
            draftId: "newer",
            status: "ready_for_review",
            title: "Pikachu - Base Set #58 [normal] EN",
          },
          card: { name: "Pikachu" },
        }),
      ]),
    ).toEqual([
      {
        draftId: "newer",
        status: "ready_for_review",
        label: "Pikachu - Base Set #58 [normal] EN",
      },
      {
        draftId: "older",
        status: "draft",
        label: "Charizard",
      },
    ]);
  });
});

describe("ready_for_review", () => {
  it("requires title, condition, and asking_price", () => {
    expect(
      readyForReviewMissing({
        title: "",
        condition: null,
        askingPrice: null,
      }),
    ).toEqual(["title", "condition", "asking_price"]);
    expect(
      canMarkReadyForReview({
        title: "Pikachu - Base Set #58 [normal] EN",
        condition: "NM",
        askingPrice: "9.00",
      }),
    ).toBe(true);
  });
});

describe("clipboard", () => {
  it("copies public fields only on an explicit payload, never notes", () => {
    const exported = buildClipboardExport({
      title: "Pikachu - Base Set #58 [normal] EN",
      description: "Raw English Base Set Pikachu #58, NM. Pulled from my binder. Photos are mine.",
      condition: "NM",
      askingPrice: "9.00",
      currency: "USD",
      notes: "Private: all-in was $4.04",
      intendedChannelNote: "Maybe list on eBay later",
    });
    expect(exported.published).toBe(false);
    expect(exported.trigger).toBe("user_tap_copy");
    expect(exported.plainText).toContain("Title: Pikachu - Base Set #58 [normal] EN");
    expect(exported.plainText).toContain("Asking: 9.00 USD");
    expect(exported.plainText).not.toContain("Private:");
    expect(exported.plainText).not.toContain("eBay");
    expect(exported.omittedPrivateNotes).toBe(true);
  });
});

describe("disclosure and AI flag", () => {
  it("maps checklist answers into description text only", () => {
    expect(
      disclosureSnippet({
        corners: "sharp",
        edges: "clean",
        surface: "light sleeve scuffs",
        whitening: "none noted",
        centering: "looks good",
      }),
    ).toBe(
      "Corners: sharp. Edges: clean. Surface: light sleeve scuffs. Whitening: none noted. Centering: looks good.",
    );
  });

  it("does not duplicate an already-applied snippet", () => {
    const snippet = "Corners: sharp.";
    expect(appendSnippet(snippet, snippet)).toBe(snippet);
  });

  it("keeps AI copy off", () => {
    expect(LISTING_AI_COPY_ENABLED).toBe(false);
  });

  it("reuses listing-draft disclosure answers for grading pillars", () => {
    expect(GRADING_PILLARS.map((item) => item.id)).toEqual([
      "centering",
      "corners",
      "edges",
      "surface",
    ]);
    for (const pillar of GRADING_PILLARS) {
      expect(DISCLOSURE_ITEMS).toContainEqual(pillar);
    }
    expect(GRADING_PILLARS.some((item) => item.id === "whitening")).toBe(false);
  });
});
