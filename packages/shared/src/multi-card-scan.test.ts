import { describe, expect, it } from "vitest";
import { ENGLISH_CARDS_ONLY_NOTE } from "./english-cards";
import { identifyCardMock } from "./mock-recognition";
import { mapAllDetectionsToCatalog } from "./mapper";
import {
  MULTI_CARD_SCAN_MAX,
  buildMultiCardResults,
  capMultiCardDetections,
} from "./multi-card-scan";
import type { CardFlowNormalizedRecognitionResult, RecognitionDetection } from "./types";

function det(partial: Partial<RecognitionDetection> & Pick<RecognitionDetection, "name" | "language">): RecognitionDetection {
  return {
    confidence: "High",
    matchLevel: "exact",
    vendorCardId: "v",
    setName: "Base Set",
    number: "1",
    fields: [],
    candidates: [],
    ...partial,
  };
}

describe("multi-card scan helpers", () => {
  it("caps detections at 9", () => {
    const many = Array.from({ length: 12 }, (_, i) => i);
    expect(capMultiCardDetections(many)).toHaveLength(MULTI_CARD_SCAN_MAX);
  });

  it("builds per-card results and flags non-English without allowance", async () => {
    const recognition: CardFlowNormalizedRecognitionResult = {
      provider: "mock",
      ok: true,
      vendorRequestId: "multi",
      processingTimeMs: 1,
      detections: [
        det({ name: "Pikachu", language: "en", number: "58", setName: "Base Set", vendorCardId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }),
        det({ name: "ピカチュウ", language: "ja", number: "58", setName: "Base Set" }),
      ],
      error: null,
    };
    const mappings = await mapAllDetectionsToCatalog(recognition);
    const results = buildMultiCardResults({ detections: recognition.detections, mappings });
    expect(results).toHaveLength(2);
    expect(results[0]!.countsTowardAllowance).toBe(true);
    expect(results[0]!.notice).toBeNull();
    expect(results[1]!.countsTowardAllowance).toBe(false);
    expect(results[1]!.notice).toBe(ENGLISH_CARDS_ONLY_NOTE);
    expect(results[1]!.mapping.canonicalCard).toBeNull();
  });

  it("maps the high-confidence mock as a single card result", async () => {
    const recognition = identifyCardMock("high-confidence");
    const mappings = await mapAllDetectionsToCatalog(recognition);
    const results = buildMultiCardResults({ detections: recognition.detections, mappings });
    expect(results).toHaveLength(1);
    expect(results[0]!.mapping.status).toBe("matched");
  });
});

describe("multi-card summary helpers", () => {
  it("labels skipped counts and detects when the summary should open", async () => {
    const { multiCardSkippedLabel, multiCardSummaryDone, buildMultiCardResults } = await import(
      "./multi-card-scan"
    );
    const { mapAllDetectionsToCatalog } = await import("./mapper");
    const { ENGLISH_CARDS_ONLY_NOTE: _ } = await import("./english-cards");
    expect(multiCardSkippedLabel(0)).toBe("0 cards skipped");
    expect(multiCardSkippedLabel(1)).toBe("1 card skipped");
    expect(multiCardSkippedLabel(3)).toBe("3 cards skipped");

    const recognition = {
      provider: "mock" as const,
      ok: true,
      vendorRequestId: "s",
      processingTimeMs: 1,
      detections: [
        {
          confidence: "High" as const,
          matchLevel: "exact",
          vendorCardId: "a",
          name: "Pikachu",
          setName: "Base Set",
          number: "58",
          language: "en",
          fields: [],
          candidates: [],
        },
        {
          confidence: "High" as const,
          matchLevel: "exact",
          vendorCardId: "b",
          name: "X",
          setName: "Base Set",
          number: "1",
          language: "en",
          fields: [],
          candidates: [],
        },
      ],
      error: null,
    };
    const mappings = await mapAllDetectionsToCatalog(recognition);
    let results = buildMultiCardResults({ detections: recognition.detections, mappings });
    expect(multiCardSummaryDone(results)).toBe(false);
    results = results.map((r, i) => ({
      ...r,
      state: i === 0 ? ("confirmed" as const) : ("skipped" as const),
      cardflowCardId: i === 0 ? "cf" : null,
    }));
    expect(multiCardSummaryDone(results)).toBe(true);
    expect(multiCardSummaryDone(results.slice(0, 1))).toBe(false);
  });
});
