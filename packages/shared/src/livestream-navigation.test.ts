import { describe, expect, it } from "vitest";
import {
  LIVESTREAM_DESKTOP_USER_AGENT,
  allowLivestreamNavigation,
  livestreamUsesDesktopSite,
  livestreamWebViewUserAgent,
} from "./livestream-navigation";

describe("livestream navigation", () => {
  it("asks Whatnot for the desktop site so the live player mounts", () => {
    expect(livestreamUsesDesktopSite("https://www.whatnot.com/tag/pokemon_cards")).toBe(true);
    expect(livestreamUsesDesktopSite("https://www.whatnot.com/live/07c74164-d372-4b79-a741-5f16ce8844f2")).toBe(
      true,
    );
    expect(livestreamWebViewUserAgent("https://www.whatnot.com/live/abc")).toBe(
      LIVESTREAM_DESKTOP_USER_AGENT,
    );
    expect(LIVESTREAM_DESKTOP_USER_AGENT).not.toMatch(/Mobile/i);
    expect(livestreamUsesDesktopSite("https://www.ebay.com/ebaylive")).toBe(false);
    expect(livestreamWebViewUserAgent("https://www.ebay.com/ebaylive")).toBeNull();
  });

  it("keeps Google sign-in inside the livestream page", () => {
    const google = "https://accounts.google.com/o/oauth2/v2/auth?client_id=whatnot";
    expect(allowLivestreamNavigation(google)).toBe(true);
    expect(allowLivestreamNavigation("https://accounts.youtube.com/")).toBe(true);
    expect(allowLivestreamNavigation("https://www.whatnot.com/live/abc")).toBe(true);
  });

  it("keeps http pages and blocks app-store and custom-scheme handoffs", () => {
    expect(allowLivestreamNavigation("about:blank")).toBe(true);
    expect(allowLivestreamNavigation("https://www.whatnot.com/live/abc")).toBe(true);
    expect(allowLivestreamNavigation("https://stream.mux.com/playlist.m3u8")).toBe(true);
    expect(allowLivestreamNavigation("whatnot://live/abc")).toBe(false);
    expect(
      allowLivestreamNavigation(
        "intent://live/abc#Intent;scheme=whatnot;package=com.whatnot_mobile;end",
      ),
    ).toBe(false);
    expect(allowLivestreamNavigation("https://play.google.com/store/apps/details?id=com.whatnot_mobile")).toBe(
      false,
    );
    expect(allowLivestreamNavigation("https://whatnot.onelink.me/show")).toBe(false);
    expect(allowLivestreamNavigation("https://apps.apple.com/app/whatnot/id1488269261")).toBe(false);
  });
});