import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  replayLiveCardStream,
  type LiveStreamReplayFrame,
} from "./live-card-track";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as Record<string, any>;
}

function cardHash(card: number, flip = 0): string {
  const bits = Array.from({ length: 105 }, () => "0");
  const origin = (card - 1) * 16;
  for (let i = 0; i < 16; i++) bits[origin + i] = "1";
  if (flip) bits[104] = flip % 2 === 0 ? "0" : "1";
  return bits.join("");
}

describe("P0-13 livestream warp + recorded-stream eval", () => {
  it("keeps the PR 35 OpenCLIP warp eval and requires ≥90% on the recorded stream", () => {
    const warpEval = readJson("docs/livestream-warp-eval-2026-10-11.json");
    const recorded = readJson("docs/livestream-recorded-stream-eval-2026-10-13.json");

    expect(warpEval.cards).toBe(300);
    expect(warpEval.tilted.after.top1).toBeGreaterThan(warpEval.tilted.before.top1);
    expect(warpEval.steep.after.top1).toBeGreaterThan(warpEval.steep.before.top1);

    expect(recorded.match_rate).toBeGreaterThanOrEqual(0.9);
    expect(recorded.vendor_calls_per_card).toBe(1);
    expect(recorded.timing_stages).toEqual(
      expect.arrayContaining(["decode", "warp", "embed", "search", "orb"]),
    );
    expect(recorded.pr35_warp_eval).toBe("docs/livestream-warp-eval-2026-10-11.json");
  });

  it("replays a recorded stream of 5 cards at ≥90% with one model call each", () => {
    const cards = ["syn-1", "syn-2", "syn-3", "syn-4", "syn-5"];
    const frames: LiveStreamReplayFrame[] = [];
    let now = 0;
    for (const [index, id] of cards.entries()) {
      const cardBox = {
        x: index % 2 === 0 ? 0.12 : 0.58,
        y: 0.18,
        width: 0.28,
        height: 0.42,
      };
      for (let f = 0; f < 8; f++) {
        frames.push({
          box: { ...cardBox, x: cardBox.x + f * 0.002 },
          hash: cardHash(index + 1, f),
          nowMs: now,
          expectedId: id,
        });
        now += 250;
      }
      frames.push({ box: null, hash: null, nowMs: now, expectedId: null });
      now += 250;
    }
    const replay = replayLiveCardStream(frames, (frame) => frame.expectedId);
    // P1: votesBeforeLock=3 gathers sharp-frame votes before the track locks.
    expect(replay.maxCallsPerTrack).toBe(3);
    expect(replay.matchCalls).toBe(cards.length * 3);
    expect(replay.matchRate).toBeGreaterThanOrEqual(0.9);
  });
});
