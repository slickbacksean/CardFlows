import { describe, expect, it } from "vitest";
import {
  LIVE_VOTE_DEFAULTS,
  LIVE_VOTE_PICK_ONE_COPY,
  LIVE_VOTE_WAITING_COPY,
  createLiveIdentityVoter,
  voteLiveIdentity,
} from "./live-identity-vote";

describe("live identity vote", () => {
  it("waits until enough sharp frames arrive", () => {
    const result = voteLiveIdentity([
      { tcgdexId: "base1-58", similarity: 0.91 },
      { tcgdexId: "base1-58", similarity: 0.9 },
    ]);
    expect(result.tier).toBe("waiting");
    expect(result.copy).toBe(LIVE_VOTE_WAITING_COPY);
    expect(result.tcgdexId).toBeNull();
  });

  it("auto-shows on a 2-of-3 majority with strong similarity", () => {
    const result = voteLiveIdentity([
      { tcgdexId: "base1-58", similarity: 0.91 },
      { tcgdexId: "base1-4", similarity: 0.8 },
      { tcgdexId: "base1-58", similarity: 0.92 },
    ]);
    expect(result.tier).toBe("auto_show");
    expect(result.tcgdexId).toBe("base1-58");
    expect(result.copy).toBeNull();
    expect(result.votes).toBe(2);
  });

  it("auto-shows on majority alone when similarities are absent", () => {
    const result = voteLiveIdentity([
      { tcgdexId: "sv1-1" },
      { tcgdexId: "sv1-1" },
      { tcgdexId: "sv1-1" },
    ]);
    expect(result.tier).toBe("auto_show");
    expect(result.tcgdexId).toBe("sv1-1");
  });

  it("offers a top-3 pick when votes split", () => {
    const result = voteLiveIdentity([
      {
        tcgdexId: "base1-58",
        similarity: 0.8,
        candidates: [
          { tcgdexId: "base1-58", similarity: 0.8 },
          { tcgdexId: "base4-51", similarity: 0.79 },
          { tcgdexId: "base1-4", similarity: 0.7 },
        ],
      },
      {
        tcgdexId: "base4-51",
        similarity: 0.81,
        candidates: [
          { tcgdexId: "base4-51", similarity: 0.81 },
          { tcgdexId: "base1-58", similarity: 0.8 },
        ],
      },
      {
        tcgdexId: "base1-58",
        similarity: 0.79,
        candidates: [
          { tcgdexId: "base1-58", similarity: 0.79 },
          { tcgdexId: "base4-51", similarity: 0.78 },
        ],
      },
    ]);
    expect(result.tier).toBe("pick_one");
    expect(result.copy).toBe(LIVE_VOTE_PICK_ONE_COPY);
    expect(result.tcgdexId).toBeNull();
    expect(result.top3.map((c) => c.tcgdexId)).toEqual(
      expect.arrayContaining(["base1-58", "base4-51"]),
    );
  });

  it("waits when frames are rejected", () => {
    const result = voteLiveIdentity([
      { tcgdexId: null },
      { tcgdexId: null },
      { tcgdexId: null },
    ]);
    expect(result.tier).toBe("waiting");
    expect(result.copy).toBe(LIVE_VOTE_WAITING_COPY);
  });

  it("rolling voter resets and respects custom thresholds", () => {
    const voter = createLiveIdentityVoter({
      ...LIVE_VOTE_DEFAULTS,
      sharpFrames: 2,
      autoShowMinVotes: 2,
    });
    expect(voter.add({ tcgdexId: "sv2-25" }).tier).toBe("waiting");
    expect(voter.add({ tcgdexId: "sv2-25" }).tier).toBe("auto_show");
    voter.reset();
    expect(voter.size()).toBe(0);
    expect(voter.snapshot().tier).toBe("waiting");
  });

  describe("temporal voting", () => {
    it("auto-shows when combined score (mean + max) exceeds threshold", () => {
      const result = voteLiveIdentity(
        [
          { tcgdexId: "base1-58", similarity: 0.85 },
          { tcgdexId: "base1-58", similarity: 0.87 },
          { tcgdexId: "base1-58", similarity: 0.84 },
        ],
        { useTemporal: true, sharpFrames: 3, temporalMinCombinedScore: 1.65 },
      );
      expect(result.tier).toBe("auto_show");
      expect(result.tcgdexId).toBe("base1-58");
      expect(result.combinedScore).toBeCloseTo(0.853 + 0.87, 2);
      expect(result.meanSimilarity).toBeCloseTo(0.853, 2);
    });

    it("waits when combined score is below threshold", () => {
      const result = voteLiveIdentity(
        [
          { tcgdexId: "base1-58", similarity: 0.7 },
          { tcgdexId: "base1-58", similarity: 0.72 },
          { tcgdexId: "base1-58", similarity: 0.68 },
        ],
        { useTemporal: true, sharpFrames: 3, temporalMinCombinedScore: 1.65 },
      );
      expect(result.tier).toBe("waiting");
      expect(result.tcgdexId).toBeNull();
    });

    it("pick-one when scores are close", () => {
      const result = voteLiveIdentity(
        [
          { tcgdexId: "base1-58", similarity: 0.82 },
          { tcgdexId: "base4-51", similarity: 0.81 },
          { tcgdexId: "base1-58", similarity: 0.80 },
        ],
        { useTemporal: true, sharpFrames: 3, temporalMinCombinedScore: 1.5, autoShowMinMargin: 0.05 },
      );
      expect(result.tier).toBe("pick_one");
      expect(result.top3.length).toBeGreaterThanOrEqual(2);
    });

    it("handles mixed card identities across frames", () => {
      const result = voteLiveIdentity(
        [
          { tcgdexId: "base1-58", similarity: 0.88 },
          { tcgdexId: "base1-58", similarity: 0.86 },
          { tcgdexId: "base1-4", similarity: 0.75 },
          { tcgdexId: "base1-58", similarity: 0.87 },
        ],
        { useTemporal: true, sharpFrames: 4, temporalMinCombinedScore: 1.7 },
      );
      expect(result.tier).toBe("auto_show");
      expect(result.tcgdexId).toBe("base1-58");
      const expected = (0.88 + 0.86 + 0.87) / 3 + 0.88;
      expect(result.combinedScore).toBeCloseTo(expected, 2);
    });

    it("works with larger frame buffers", () => {
      const frames = Array.from({ length: 12 }, (_, i) => ({
        tcgdexId: "sv3-25",
        similarity: 0.8 + (i % 3) * 0.01,
      }));
      const result = voteLiveIdentity(frames, {
        useTemporal: true,
        sharpFrames: 12,
        temporalMinCombinedScore: 1.6,
      });
      expect(result.tier).toBe("auto_show");
      expect(result.tcgdexId).toBe("sv3-25");
      expect(result.observations).toBe(12);
    });

    it("boosts candidates that match OCR names", () => {
      const result = voteLiveIdentity(
        [
          {
            tcgdexId: "base1-58",
            similarity: 0.83,
            candidates: [
              { tcgdexId: "base1-58", similarity: 0.83, name: "Charizard" },
              { tcgdexId: "base4-4", similarity: 0.84, name: "Alakazam" },
            ],
            ocrNames: ["Charizard"],
          },
          {
            tcgdexId: "base1-58",
            similarity: 0.82,
            candidates: [
              { tcgdexId: "base1-58", similarity: 0.82, name: "Charizard" },
              { tcgdexId: "base4-4", similarity: 0.83, name: "Alakazam" },
            ],
            ocrNames: ["Charizard"],
          },
          {
            tcgdexId: "base1-58",
            similarity: 0.84,
            candidates: [
              { tcgdexId: "base1-58", similarity: 0.84, name: "Charizard" },
              { tcgdexId: "base4-4", similarity: 0.85, name: "Alakazam" },
            ],
            ocrNames: ["Charizard", "Fire"],
          },
        ],
        { useTemporal: true, sharpFrames: 3, temporalMinCombinedScore: 1.6 },
      );
      expect(result.tier).toBe("auto_show");
      expect(result.tcgdexId).toBe("base1-58");
    });

    it("boosts candidates that match OCR collector numbers", () => {
      const result = voteLiveIdentity(
        [
          {
            tcgdexId: "base1-4",
            similarity: 0.82,
            candidates: [
              { tcgdexId: "base1-4", similarity: 0.82, name: "Charizard", localId: "4" },
              { tcgdexId: "base4-4", similarity: 0.83, name: "Charizard", localId: "4" },
            ],
            ocrNumber: "4",
          },
          {
            tcgdexId: "base1-4",
            similarity: 0.81,
            candidates: [
              { tcgdexId: "base1-4", similarity: 0.81, name: "Charizard", localId: "4" },
              { tcgdexId: "base4-4", similarity: 0.82, name: "Charizard", localId: "4" },
            ],
            ocrNumber: "4",
          },
        ],
        { useTemporal: true, sharpFrames: 2, temporalMinCombinedScore: 1.5 },
      );
      expect(result.tier).toBe("auto_show");
      expect(result.top3[0]?.tcgdexId).toBeTruthy();
    });

    it("pools OCR text across frames", () => {
      const result = voteLiveIdentity(
        [
          {
            tcgdexId: "base1-58",
            similarity: 0.85,
            ocrNames: ["Charizard"],
            ocrNumber: null,
          },
          {
            tcgdexId: "base1-58",
            similarity: 0.84,
            ocrNames: ["Fire"],
            ocrNumber: "4",
          },
          {
            tcgdexId: "base1-58",
            similarity: 0.86,
            ocrNames: null,
            ocrNumber: null,
          },
        ],
        { useTemporal: true, sharpFrames: 3, temporalMinCombinedScore: 1.65 },
      );
      expect(result.tier).toBe("auto_show");
    });
  });
});
