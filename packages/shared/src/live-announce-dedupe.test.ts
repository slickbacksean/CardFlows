import { describe, expect, it } from "vitest";
import { LIVE_ANNOUNCE_DEDUPE_MS, createLiveAnnounceDedupe } from "./live-announce-dedupe";

describe("live announce dedupe", () => {
  it("announces once inside the 60s window", () => {
    const dedupe = createLiveAnnounceDedupe();
    expect(dedupe.shouldAnnounce("base1-58", 0)).toBe(true);
    dedupe.noteAnnounced("base1-58", 0);
    expect(dedupe.shouldAnnounce("base1-58", 30_000)).toBe(false);
    expect(dedupe.shouldAnnounce("base1-58", LIVE_ANNOUNCE_DEDUPE_MS)).toBe(true);
    expect(dedupe.shouldAnnounce("sv1-1", 1_000)).toBe(true);
  });

  it("clears on user tap", () => {
    const dedupe = createLiveAnnounceDedupe();
    dedupe.noteAnnounced("base1-58", 0);
    dedupe.clear("base1-58");
    expect(dedupe.shouldAnnounce("base1-58", 1_000)).toBe(true);
  });
});
