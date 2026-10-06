import { describe, expect, it } from "vitest";
import { listingDraftStatusLabel } from "./listing-draft";
import { resolveClientApiUrl } from "./client-api-url";

const LOOPBACK = "http://127.0.0.1:3001";
const CONFIGURED = "https://api.cardflow.example";

describe("resolveClientApiUrl", () => {
  it("honors the configured URL on web and keeps loopback for a dev simulator", () => {
    expect(
      resolveClientApiUrl({
        configured: CONFIGURED,
        platform: "web",
        isDev: true,
        isPhysical: false,
        defaultUrl: LOOPBACK,
      }),
    ).toBe(CONFIGURED);
    expect(
      resolveClientApiUrl({
        configured: "http://192.168.1.8:3001",
        platform: "ios",
        isDev: true,
        isPhysical: false,
        defaultUrl: LOOPBACK,
      }),
    ).toBe(LOOPBACK);
    expect(
      resolveClientApiUrl({
        configured: CONFIGURED,
        platform: "ios",
        isDev: false,
        isPhysical: false,
        defaultUrl: LOOPBACK,
      }),
    ).toBe(CONFIGURED);
    expect(
      resolveClientApiUrl({
        configured: "http://192.168.1.8:3001",
        platform: "ios",
        isDev: true,
        isPhysical: true,
        defaultUrl: LOOPBACK,
      }),
    ).toBe("http://192.168.1.8:8081");
  });
});

describe("listingDraftStatusLabel", () => {
  it("does not show the raw ready_for_review state", () => {
    expect(listingDraftStatusLabel("ready_for_review")).toBe("Ready for review");
    expect(listingDraftStatusLabel("draft")).toBe("Draft");
    expect(listingDraftStatusLabel("ready_for_review")).not.toBe("ready_for_review");
  });
});
