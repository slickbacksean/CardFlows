import { describe, expect, it } from "vitest";
import { LIVE_HLS_REPORT_SCRIPT, liveHlsUrlFromWebMessage, normalizeLiveHlsUrl } from "./live-hls-url";

const PLAYLIST = "https://cdn.example.com/live/index.m3u8?token=1";

describe("normalizeLiveHlsUrl", () => {
  it("keeps an https playlist", () => {
    expect(normalizeLiveHlsUrl(`  ${PLAYLIST}  `)).toBe(PLAYLIST);
  });

  it("rejects anything that is not an https m3u8", () => {
    expect(normalizeLiveHlsUrl("http://cdn.example.com/a.m3u8")).toBeNull();
    expect(normalizeLiveHlsUrl("https://127.0.0.1/a.m3u8")).toBeNull();
    expect(normalizeLiveHlsUrl("https://localhost/a.m3u8")).toBeNull();
    expect(normalizeLiveHlsUrl("https://cdn.example.com/watch")).toBeNull();
    expect(normalizeLiveHlsUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLiveHlsUrl("")).toBeNull();
    expect(normalizeLiveHlsUrl(null)).toBeNull();
  });
});

describe("liveHlsUrlFromWebMessage", () => {
  it("reads a WebView postMessage and a Capgo detail wrapper", () => {
    expect(liveHlsUrlFromWebMessage(JSON.stringify({ cardflow: "hls", url: PLAYLIST }))).toBe(
      PLAYLIST,
    );
    expect(
      liveHlsUrlFromWebMessage({
        id: "browser",
        detail: { cardflow: "hls", url: PLAYLIST },
      }),
    ).toBe(PLAYLIST);
    expect(liveHlsUrlFromWebMessage({ cardflow: "other", url: PLAYLIST })).toBeNull();
  });
});

describe("LIVE_HLS_REPORT_SCRIPT", () => {
  it("reports playlist urls and does not snapshot the page", () => {
    expect(LIVE_HLS_REPORT_SCRIPT).toContain(".m3u8");
    expect(LIVE_HLS_REPORT_SCRIPT).toContain("postMessage");
    expect(LIVE_HLS_REPORT_SCRIPT).toContain('cardflow: "hls"');
    expect(LIVE_HLS_REPORT_SCRIPT).not.toMatch(
      /view-shot|captureScreen|capturePage|takeSnapshot|toDataURL|captureRef|ViewShot|takeScreenshot/i,
    );
  });
});
