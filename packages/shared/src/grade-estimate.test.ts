import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURE_FLAG_DEFAULTS } from "./feature-flags";
import {
  computeOverallGrade,
  createMockCardGradingProvider,
  createOffCardGradingProvider,
  emptyGradeEstimate,
  GRADE_ESTIMATE_UNAVAILABLE_COPY,
  unavailableGradeEstimate,
  GRADE_ESTIMATE_DISCLAIMER,
  GRADE_ESTIMATE_EMPTY_COPY,
  GRADE_ESTIMATE_ENABLED_FLAG,
  GRADE_ESTIMATE_GUIDANCE_HISTORY_LABEL,
  GRADE_ESTIMATE_LABEL,
  GRADE_IMAGE_MAX_BYTES,
  GRADE_PHOTOS_HINT,
  gradeEstimateFromSubgrades,
  gradeEstimateFromOverall,
  GRADING_TAB_CONSTRAINT,
  mockCardGradingProvider,
  parseStoredGradeEstimate,
  roundGrade,
  serializeGradeEstimate,
  type GradeSubgrade,
} from "./grade-estimate";
import { canMovePurchasedCopyToSubmitted } from "./grading";

function sub(id: GradeSubgrade["id"], side: GradeSubgrade["side"], score: number): GradeSubgrade {
  return { id, side, score, ratio: null };
}

describe("grade rounding and overall", () => {
  it("rounds fractions the casecomp way", () => {
    expect(roundGrade(8.24)).toBe(8);
    expect(roundGrade(8.25)).toBe(8.5);
    expect(roundGrade(8.74)).toBe(8.5);
    expect(roundGrade(8.75)).toBe(9);
    expect(roundGrade(10.4)).toBe(10);
  });

  it("weights front 60 / back 40 and caps at lowest subgrade + 1", () => {
    const { overall, usedBack } = computeOverallGrade([
      sub("centering", "front", 9),
      sub("corners", "front", 9),
      sub("edges", "front", 9),
      sub("surface", "front", 9),
      sub("centering", "back", 9),
      sub("corners", "back", 9),
      sub("edges", "back", 9),
      sub("surface", "back", 5),
    ]);
    expect(usedBack).toBe(true);
    expect(overall).toBe(6);
  });

  it("uses front only when back is missing", () => {
    const { overall, usedBack } = computeOverallGrade([
      sub("centering", "front", 8),
      sub("corners", "front", 8),
      sub("edges", "front", 8),
      sub("surface", "front", 8),
    ]);
    expect(usedBack).toBe(false);
    expect(overall).toBe(8);
  });

  it("does not invent an overall without front scores", () => {
    expect(computeOverallGrade([sub("centering", "back", 10)])).toEqual({
      overall: null,
      usedBack: false,
      frontAvg: null,
      backAvg: null,
      lowest: null,
    });
  });
});

describe("grade estimate DTO", () => {
  it("is labeled an estimate and never a cert", () => {
    const empty = emptyGradeEstimate();
    expect(empty.overall).toBeNull();
    expect(empty.display).toBe("No estimate");
    expect(empty.label).toBe(GRADE_ESTIMATE_LABEL);
    expect(empty.notACert).toBe(true);
    expect(empty.disclaimer).toBe(GRADE_ESTIMATE_DISCLAIMER);
    expect(empty.subgrades).toHaveLength(8);
    expect(empty.mathTrace).toEqual([]);
    expect(GRADING_TAB_CONSTRAINT.toLowerCase()).not.toContain("profit");
    expect(GRADING_TAB_CONSTRAINT.toLowerCase()).toContain("not a cert");
    expect(GRADE_ESTIMATE_EMPTY_COPY).toBe("No photo estimate yet.");
    expect(GRADE_ESTIMATE_UNAVAILABLE_COPY).toBe("Estimate unavailable.");
    expect(GRADE_PHOTOS_HINT.toLowerCase()).toContain("still submit");
    expect(GRADE_ESTIMATE_ENABLED_FLAG in FEATURE_FLAG_DEFAULTS).toBe(false);
    expect(canMovePurchasedCopyToSubmitted("purchased")).toBe(true);
  });

  it("caps confidence at medium without a back photo", () => {
    const estimate = gradeEstimateFromSubgrades(
      [
        sub("centering", "front", 8),
        sub("corners", "front", 8),
        sub("edges", "front", 8),
        sub("surface", "front", 8),
      ],
      "high",
    );
    expect(estimate.usedBack).toBe(false);
    expect(estimate.confidence).toBe("medium");
    expect(estimate.display).toBe("Estimate 8");
    expect(estimate.mathTrace.some((line) => line.includes("from front only"))).toBe(true);
  });

  it("builds an overall-only CNN estimate without inventing pillar scores", () => {
    const estimate = gradeEstimateFromOverall(8.4, {
      usedBack: true,
      confidence: "high",
      mathTrace: ["overall=8.5 from dual-branch CNN"],
    });
    expect(estimate.overall).toBe(8.5);
    expect(estimate.display).toBe("Estimate 8.5");
    expect(estimate.notACert).toBe(true);
    expect(estimate.usedBack).toBe(true);
    expect(estimate.confidence).toBe("high");
    expect(estimate.subgrades.every((row) => row.score === null)).toBe(true);
    expect(gradeEstimateFromOverall(null).overall).toBeNull();
  });

  it("fills centering scores from measured ratios and names the bottleneck", () => {
    const estimate = gradeEstimateFromSubgrades(
      [
        { id: "centering", side: "front", score: null, ratio: "70/30" },
        sub("corners", "front", 9),
        sub("edges", "front", 9),
        sub("surface", "front", 9),
      ],
      "medium",
    );
    expect(estimate.subgrades.find((row) => row.id === "centering" && row.side === "front")?.score).toBe(
      7,
    );
    expect(estimate.overall).toBe(8);
    expect(estimate.mathTrace).toEqual(
      expect.arrayContaining([
        "centering front=7 from 70/30",
        "bottleneck: front centering 7 (70/30)",
      ]),
    );
  });

  it("round-trips stored JSON as guidance history, never a cert", () => {
    const estimate = gradeEstimateFromSubgrades(
      [
        sub("centering", "front", 8),
        sub("corners", "front", 8),
        sub("edges", "front", 8),
        sub("surface", "front", 8),
      ],
      "high",
    );
    const stored = parseStoredGradeEstimate(serializeGradeEstimate(estimate));
    expect(GRADE_ESTIMATE_GUIDANCE_HISTORY_LABEL).toBe("Guidance history");
    expect(stored?.display).toBe("Estimate 8");
    expect(stored?.notACert).toBe(true);
    expect(stored?.disclaimer).toBe(GRADE_ESTIMATE_DISCLAIMER);
    expect(parseStoredGradeEstimate(null)).toBeNull();
    expect(parseStoredGradeEstimate("{")).toBeNull();
    expect(parseStoredGradeEstimate(JSON.stringify({ overall: 10 }))).toBeNull();
    expect(parseStoredGradeEstimate(JSON.stringify({ overall: 9, notACert: true }))?.display).toBe(
      "Estimate 9",
    );
  });
});

function jpeg(byteLength = 12): { byteLength: number; mimeType: string } {
  return { byteLength, mimeType: "image/jpeg" };
}

describe("mock and off grading providers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a fixture when photos exist and never calls the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("grade mock must not call the network");
    });
    try {
      const estimate = await mockCardGradingProvider.estimateGrade({
        frontImage: jpeg(),
        backImage: jpeg(),
        mimeType: "image/jpeg",
      });
      expect(mockCardGradingProvider.name).toBe("mock");
      expect(GRADE_ESTIMATE_ENABLED_FLAG).toBe("grade_estimate_enabled");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(estimate.overall).not.toBeNull();
      expect(estimate.usedBack).toBe(true);
      expect(estimate.confidence).toBe("high");
      expect(estimate.notACert).toBe(true);
      expect(estimate.subgrades.find((row) => row.id === "centering" && row.side === "front")).toEqual({
        id: "centering",
        side: "front",
        score: 9,
        ratio: "58/42",
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("stays empty without a usable front still", async () => {
    const provider = createMockCardGradingProvider();
    const empty = await provider.estimateGrade({
      frontImage: null,
      backImage: jpeg(),
    });
    expect(empty.overall).toBeNull();
    expect(empty.display).toBe("No estimate");

    const oversize = await provider.estimateGrade({
      frontImage: jpeg(GRADE_IMAGE_MAX_BYTES + 1),
      backImage: null,
    });
    expect(oversize.overall).toBeNull();

    const badMime = await provider.estimateGrade({
      frontImage: { byteLength: 12, mimeType: "application/pdf" },
      backImage: null,
    });
    expect(badMime.overall).toBeNull();
  });

  it("returns empty when the flag is off even if photos exist", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("off grading must not call the network");
    });
    try {
      const off = createOffCardGradingProvider();
      const estimate = await off.estimateGrade({
        frontImage: jpeg(),
        backImage: jpeg(),
      });
      expect(off.name).toBe("off");
      expect(off.featureDisabled).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(estimate).toEqual(unavailableGradeEstimate());
      expect(estimate.overall).toBeNull();
      expect(estimate.display).toBe(GRADE_ESTIMATE_UNAVAILABLE_COPY);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
