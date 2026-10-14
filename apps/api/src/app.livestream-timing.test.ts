import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { normalizeIdentityCropQuad } from "./live-identity-openclip";
import { createMemoryStore } from "./store";

const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, ...Array(40).fill(9)]).toString("base64");
const quad = [10, 12, 200, 8, 210, 300, 4, 296];

function fakeOpenclip(seen: Array<number[] | null | undefined>) {
  return {
    name: "openclip_hnsw" as const,
    matchCropJpeg: async (
      _bytes: Uint8Array,
      _mime?: string,
      options?: { name?: string; quad?: number[] | null },
    ) => {
      seen.push(options?.quad);
      return {
        pipeline: "openclip_hnsw" as const,
        accepted: true,
        tcgdexId: "swsh3-136",
        similarity: 0.93,
        warped: Boolean(options?.quad),
        timings: { decodeMs: 2, warpMs: 1, embedMs: 40, searchMs: 1, orbMs: 0, totalMs: 44 },
      };
    },
  };
}

async function identify(app: ReturnType<typeof createApp>, extra: Record<string, unknown> = {}) {
  const response = await app.request("/v1/livestream/identify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "live_video",
      platform: "ios",
      cardDetected: true,
      identityCropJpeg: tinyJpeg,
      ...extra,
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describe("livestream timing + crop corners", () => {
  it("validates corner payloads", () => {
    expect(normalizeIdentityCropQuad(quad)).toEqual(quad);
    expect(normalizeIdentityCropQuad([1, 2, 3])).toBeNull();
    expect(normalizeIdentityCropQuad([1, 2, 3, 4, 5, 6, 7, "8"])).toBeNull();
    expect(normalizeIdentityCropQuad("nope")).toBeNull();
  });

  it("forwards corners to the sidecar and keeps timing off by default", async () => {
    const seen: Array<number[] | null | undefined> = [];
    const app = createApp(createMemoryStore(), {
      liveIdentityOpenclip: fakeOpenclip(seen),
      livestreamTiming: false,
    });
    const withQuad = await identify(app, { identityCropQuad: quad });
    expect(withQuad.body.identity.tcgdexId).toBe("swsh3-136");
    expect(withQuad.body.timing).toBeUndefined();
    await identify(app, { identityCropQuad: [1, 2] });
    expect(seen).toEqual([quad, null]);
    const summary = await app.request("/v1/livestream/timing");
    expect(summary.status).toBe(404);
  });

  it("reports per-stage timings and p50/p95 when the debug flag is on", async () => {
    const app = createApp(createMemoryStore(), {
      liveIdentityOpenclip: fakeOpenclip([]),
      livestreamTiming: true,
    });
    const first = await identify(app, { identityCropQuad: quad });
    expect(first.body.timing.warped).toBe(true);
    expect(first.body.timing.stages.embed).toBe(40);
    expect(typeof first.body.timing.stages.server).toBe("number");
    await identify(app);
    const response = await app.request("/v1/livestream/timing");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { summary: Record<string, any> };
    expect(body.summary.samples).toBe(2);
    expect(body.summary.acceptRate).toBe(1);
    expect(body.summary.warpedRate).toBe(0.5);
    expect(body.summary.stages.embed).toMatchObject({ count: 2, p50: 40, p95: 40 });
  });

  it("keeps phone 4-corners when YOLO also finds a card, and uses YOLO corners when the phone has none", async () => {
    const width = 40;
    const height = 56;
    const rgba = Buffer.alloc(width * height * 4, 180);
    const videoFrameJpeg = jpeg.encode({ data: rgba, width, height }, 80).data.toString("base64");
    const yolo = {
      async detect() {
        return [{ cx: 20, cy: 28, width: 24, height: 36, angle: 0.3, score: 0.91 }];
      },
    };
    const phoneSeen: Array<number[] | null | undefined> = [];
    const phoneApp = createApp(createMemoryStore(), {
      liveVideoObb: () => yolo,
      liveIdentityOpenclip: fakeOpenclip(phoneSeen),
    });
    await identify(phoneApp, { identityCropQuad: quad, videoFrameJpeg });
    expect(phoneSeen).toEqual([quad]);

    const yoloSeen: Array<number[] | null | undefined> = [];
    const yoloApp = createApp(createMemoryStore(), {
      liveVideoObb: () => yolo,
      liveIdentityOpenclip: fakeOpenclip(yoloSeen),
    });
    await identify(yoloApp, { videoFrameJpeg, identityCropJpeg: undefined });
    expect(yoloSeen[0]).toHaveLength(8);
    expect(yoloSeen[0]?.every((n) => typeof n === "number" && Number.isFinite(n))).toBe(true);
  });
});
