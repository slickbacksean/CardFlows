import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapRecognitionToCatalog } from "./mapper";
import { identifyCardMock } from "./mock-recognition";
import { emptyObbPhashResult } from "./obb-phash";
import { stillIdentifySkippedResult } from "./recognition-flags";
import {
  CONFIDENCE_SCREEN_LABEL,
  CONFIRM_AMBIGUOUS_TITLE,
  CONFIRM_COULD_NOT_CONFIRM_MESSAGE,
  CONFIRM_SEARCH_FRAMES,
  CONFIRM_SEARCH_MANUALLY_LABEL,
  CONFIRM_COULD_NOT_IDENTIFY_TITLE,
  CONFIRM_TIPS,
  HOW_THIS_WORKS_PARAGRAPHS,
  HOW_THIS_WORKS_TITLE,
  MAX_BUY_YOUR_RULE_LABEL,
  PRICE_ESTIMATE_SCREEN_LABEL,
  PRICE_ESTIMATE_UNAVAILABLE_COPY,
  PRICE_SOURCE_CARDSIGHT,
  PRICE_SOURCE_POKECOLLECTOR,
  PRICE_SOURCE_POKETRACE,
  PRICE_SOURCE_YOUR_PRICE,
  WHAT_THIS_MEANS_LABEL,
  confidenceWord,
  confirmEstimateCopyViolations,
  confirmFailSoftBody,
  confirmFailSoftTitle,
  confirmFrameFromScan,
  confirmLabelCopy,
  forbiddenConfirmClaim,
  forbiddenConfirmFinanceClaim,
  formatMaxBuyEstimateMeta,
  formatPriceEstimateMeta,
  formatPriceUpdatedAt,
  priceSourceLabel,
  resolvePriceSourceKind,
} from "./confirm-copy";
import { PREGRADE_COPY } from "./pregrade-copy";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Confirm fail-soft copy", () => {
  it("uses the user-safe search sentence and never claims accuracy", () => {
    expect(CONFIRM_COULD_NOT_CONFIRM_MESSAGE).toBe(
      "We couldn't confirm this card — search by English set and number",
    );
    expect(CONFIRM_SEARCH_MANUALLY_LABEL).toBe("Search manually");
    expect(CONFIRM_COULD_NOT_IDENTIFY_TITLE).toBe("Couldn't identify");
    expect(confirmFailSoftTitle("no-match")).toBe(CONFIRM_COULD_NOT_IDENTIFY_TITLE);
    expect(CONFIRM_AMBIGUOUS_TITLE).toContain("pick the print");
    expect(forbiddenConfirmClaim(CONFIRM_COULD_NOT_CONFIRM_MESSAGE)).toBeNull();
    expect(forbiddenConfirmClaim(CONFIRM_AMBIGUOUS_TITLE)).toBeNull();
    expect(forbiddenConfirmClaim("PokeSniper verified authentic")).toBe("verified_authentic");
    expect(forbiddenConfirmClaim("99% identification accuracy")).toBe("accuracy_claim");
  });

  it("sends no-box, no-hash, and ambiguous to Search manually", () => {
    expect(CONFIRM_SEARCH_FRAMES).toEqual([
      "ambiguous",
      "no-card",
      "no-match",
      "timeout",
      "rate-limit",
    ]);

    expect(
      confirmFrameFromScan({
        recognitionOk: true,
        detectionCount: 0,
        mappingStatus: "no_match",
        hasCanonicalCard: false,
      }),
    ).toBe("no-card");

    expect(
      confirmFrameFromScan({
        recognitionOk: true,
        detectionCount: 1,
        mappingStatus: "no_match",
        hasCanonicalCard: false,
      }),
    ).toBe("no-match");

    expect(
      confirmFrameFromScan({
        recognitionOk: true,
        detectionCount: 1,
        mappingStatus: "ambiguous",
        hasCanonicalCard: false,
      }),
    ).toBe("ambiguous");

    expect(
      confirmFrameFromScan({
        recognitionOk: false,
        recognitionCode: "BAD_REQUEST",
        detectionCount: 0,
        mappingStatus: "catalog_unavailable",
        hasCanonicalCard: false,
      }),
    ).toBe("no-card");

    expect(confirmFailSoftBody("no-card")).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
    expect(confirmFailSoftBody("no-match")).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
    expect(confirmFailSoftBody("ambiguous")).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
  });

  it("maps mock no-card / no-match / ambiguous onto the same Confirm search path", async () => {
    const noCard = await mapRecognitionToCatalog(identifyCardMock("no-card"));
    expect(noCard.status).toBe("no_match");
    expect(noCard.userConfirmation.recommendedUx).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
    expect(noCard.userConfirmation.required).toBe(true);

    const noMatch = await mapRecognitionToCatalog(identifyCardMock("no-match"));
    expect(noMatch.status).toBe("no_match");
    expect(noMatch.userConfirmation.recommendedUx).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);

    const ambiguous = await mapRecognitionToCatalog(identifyCardMock("ambiguous"));
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.userConfirmation.recommendedUx).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
    expect(ambiguous.candidates.length).toBeGreaterThan(1);

    const skipped = await mapRecognitionToCatalog(stillIdentifySkippedResult("missing_image"));
    expect(skipped.userConfirmation.recommendedUx).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);

    const noBox = await mapRecognitionToCatalog(emptyObbPhashResult());
    expect(noBox.userConfirmation.recommendedUx).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
  });

  it("Confirm screen shows the shared copy, picker plus search, and no accuracy claims", () => {
    const screen = readRepoFile("apps/mobile/app/scan/[scanId].tsx");
    expect(screen).toContain("CONFIRM_COULD_NOT_CONFIRM_MESSAGE");
    expect(screen).toContain("CONFIRM_SEARCH_MANUALLY_LABEL");
    expect(screen).toContain("CONFIRM_AMBIGUOUS_TITLE");
    expect(screen).toContain("CONFIRM_SEARCH_FRAMES");
    expect(screen).toContain("MANUAL_SEARCH_FRAMES");
    expect(screen).toContain("confirmFrameFromScan");
    expect(screen).toContain("searchCatalog");
    expect(screen).toContain("AmbiguousConfirm");
    expect(screen).toContain('frame === "no-card"');
    expect(screen).toContain('frame === "no-match"');
    expect(screen).toContain('frame === "ambiguous"');
    expect(forbiddenConfirmClaim(screen)).toBeNull();
    expect(screen).not.toMatch(/verified authentic/i);
    expect(screen).not.toMatch(/\baccurac(?:y|ate|ately)\b/i);
  });
});

describe("P0-05 Confirm and Decide labels", () => {
  const now = new Date("2026-10-13T18:00:00.000Z");

  it("uses the standing pre-grade wording and Max Buy (your rule)", () => {
    expect(HOW_THIS_WORKS_TITLE).toBe("How this works");
    expect(MAX_BUY_YOUR_RULE_LABEL).toBe("Max Buy (your rule)");
    expect(PRICE_ESTIMATE_SCREEN_LABEL).toBe("Price estimate");
    expect(CONFIDENCE_SCREEN_LABEL).toBe("Confidence");
    expect(WHAT_THIS_MEANS_LABEL).toBe("What does this mean?");
    expect(HOW_THIS_WORKS_PARAGRAPHS[0]).toContain(PREGRADE_COPY.title);
    expect(HOW_THIS_WORKS_PARAGRAPHS[0]).toContain(PREGRADE_COPY.disclaimer);
    expect(CONFIRM_TIPS.estimate).toBe(PREGRADE_COPY.disclaimer);
    expect(CONFIRM_TIPS.maxBuy).toContain(MAX_BUY_YOUR_RULE_LABEL);
    expect(CONFIRM_TIPS.maxBuy).toContain("not a market price");
    expect(CONFIRM_TIPS.confidence).toContain("High, Medium, or Low");
    expect(CONFIRM_TIPS.priceSource).toContain("Estimate only");
  });

  it("maps vendor and user sources without calling Max Buy a market price", () => {
    expect(priceSourceLabel(resolvePriceSourceKind({ provider: "poketrace" }))).toBe(
      PRICE_SOURCE_POKETRACE,
    );
    expect(priceSourceLabel(resolvePriceSourceKind({ provider: "cardsight" }))).toBe(
      PRICE_SOURCE_CARDSIGHT,
    );
    expect(
      priceSourceLabel(resolvePriceSourceKind({ referenceSource: "tcgdex_via_pokecollector" })),
    ).toBe(PRICE_SOURCE_POKECOLLECTOR);
    expect(priceSourceLabel(resolvePriceSourceKind({ userEntered: true }))).toBe(
      PRICE_SOURCE_YOUR_PRICE,
    );
    expect(confidenceWord("high")).toBe("High");
    expect(confidenceWord("MEDIUM")).toBe("Medium");
    expect(confidenceWord("Low")).toBe("Low");
    expect(confidenceWord("Unresolved")).toBeNull();
  });

  it("labels every price as an estimate with a source and a time", () => {
    expect(
      formatPriceEstimateMeta({
        sourceLabel: PRICE_SOURCE_POKECOLLECTOR,
        fetchedAt: "2026-10-13T17:57:00.000Z",
        now,
      }),
    ).toBe("Estimate · PokéCollector · Updated 3 min ago");
    expect(
      formatPriceEstimateMeta({
        sourceLabel: PRICE_SOURCE_YOUR_PRICE,
        fetchedAt: "2026-10-13T12:00:00.000Z",
        now,
      }),
    ).toBe("Estimate · your price · Updated 6 hours ago");
    expect(formatPriceUpdatedAt("2026-10-13T17:59:30.000Z", now)).toBe("Updated just now");
    expect(formatPriceUpdatedAt(new Date(2026, 9, 1, 12).toISOString(), new Date(2026, 9, 13, 18))).toBe(
      "Updated Oct 1",
    );
    expect(
      formatMaxBuyEstimateMeta({
        sourceLabel: PRICE_SOURCE_YOUR_PRICE,
        fetchedAt: "2026-10-13T16:00:00.000Z",
        now,
      }),
    ).toBe("Estimate · based on your price · Updated 2 hours ago");
    expect(formatPriceEstimateMeta({ sourceLabel: PRICE_SOURCE_POKETRACE })).toBe(
      "Estimate · Poketrace",
    );
  });

  it("keeps estimate copy free of AI, slab houses, profit promises, and Max Buy-as-market", () => {
    for (const text of confirmLabelCopy()) {
      expect(confirmEstimateCopyViolations(text), text).toEqual([]);
      expect(forbiddenConfirmClaim(text)).toBeNull();
    }
    expect(forbiddenConfirmFinanceClaim("Max Buy is the market price")).toBe("max_buy_as_market");
    expect(forbiddenConfirmFinanceClaim("you will $12")).toBe("profit_promise");
    expect(forbiddenConfirmFinanceClaim(CONFIRM_TIPS.maxBuy)).toBeNull();
    expect(HOW_THIS_WORKS_PARAGRAPHS.join("\n")).not.toMatch(/\bAI\b/i);
    expect(HOW_THIS_WORKS_PARAGRAPHS.join("\n")).not.toMatch(/\b(PSA|BGS|CGC)\b/);
  });

  it("Confirm and Decide screens read shared labels, tips, and How this works", () => {
    const scan = readRepoFile("apps/mobile/app/scan/[scanId].tsx");
    const decide = readRepoFile("apps/mobile/app/decide/[cardflowCardId].tsx");
    const watchlist = readRepoFile("apps/mobile/components/ui/watchlist-sheet.tsx");
    const howThisWorks = readRepoFile("apps/mobile/components/ui/how-this-works-sheet.tsx");
    const tip = readRepoFile("apps/mobile/components/ui/meaning-tip.tsx");

    expect(scan).toContain("HOW_THIS_WORKS_OPEN_LABEL");
    expect(scan).toContain("HowThisWorksSheet");
    expect(scan).toContain("CONFIRM_TIPS.confidence");
    expect(scan).toContain("confidenceWord");
    expect(scan).toContain("LabeledFigure");
    expect(scan).not.toMatch(/\bAI\b/);
    expect(scan).not.toMatch(/\b(PSA|BGS|CGC)\b/);

    expect(decide).toContain("HOW_THIS_WORKS_OPEN_LABEL");
    expect(decide).toContain("HowThisWorksSheet");
    expect(decide).toContain("PRICE_ESTIMATE_SCREEN_LABEL");
    expect(decide).toContain("MAX_BUY_YOUR_RULE_LABEL");
    expect(decide).toContain("CONFIRM_TIPS.priceSource");
    expect(decide).toContain("CONFIRM_TIPS.maxBuy");
    expect(decide).toContain("CONFIRM_TIPS.confidence");
    expect(decide).toContain("CONFIRM_TIPS.estimate");
    expect(decide).toContain("PREGRADE_COPY.title");
    expect(decide).toContain("formatPriceEstimateMeta");
    expect(decide).toContain("formatMaxBuyEstimateMeta");
    expect(decide).toContain("maxBuy.disclaimer");
    expect(decide).not.toContain("Market price");
    expect(decide).not.toContain("No market price");
    expect(decide).not.toContain(PRICE_ESTIMATE_UNAVAILABLE_COPY.replace("estimate", "market"));
    expect(decide).toContain("PRICE_ESTIMATE_UNAVAILABLE_COPY");
    expect(decide).not.toMatch(/\bAI\b/);
    expect(decide).not.toMatch(/\b(PSA|BGS|CGC)\b/);

    expect(watchlist).toContain("MAX_BUY_YOUR_RULE_LABEL");
    expect(watchlist).toContain("estimateMeta");
    expect(howThisWorks).toContain("HOW_THIS_WORKS_PARAGRAPHS");
    expect(tip).toContain("WHAT_THIS_MEANS_LABEL");
  });
});
