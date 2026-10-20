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
});
