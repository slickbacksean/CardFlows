import jpeg from "jpeg-js";
import { describe, expect, it, vi } from "vitest";
import {
  AGE_GATE_VERSION,
  CARDSIGHT_CONSENT_VERSION,
  DEFAULT_INVITED_USER_ID,
  type CardFlowNormalizedRecognitionResult,
  type CardRecognitionProvider,
  type IdentifyCardRequest,
} from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { LIVE_CARDSIGHT_DEFAULTS, WHATNOT_OVERLAY_REGIONS } from "./livestream-cardsight";
import { OpsMetrics, type OpsAlert } from "./ops-metrics";
import { createMemoryStore } from "./store";

// Never a live CardSight call: a fake provider records what would have been sent.
function fakeCardSight(respond: () => CardFlowNormalizedRecognitionResult) {
  const calls: IdentifyCardRequest[] = [];
  const provider: CardRecognitionProvider = {
    name: "cardsight" as never,
    async identifyCard(req) {
      calls.push(req);
      return respond();
    },
  };
  return { calls, provider };
}

const base = identifyCardMock("high-confidence");
const result = (over: Partial<CardFlowNormalizedRecognitionResult["detections"][number]>[]) =>
  ({ ...base, provider: "cardsight", detections: over.map((o) => ({ ...base.detections[0]!, ...o })) }) as CardFlowNormalizedRecognitionResult;

function cropB64(seed = 255) {
  const data = new Uint8Array(32 * 44 * 4).fill(seed);
  return Buffer.from(jpeg.encode({ width: 32, height: 44, data }, 90).data).toString("base64");
}
const hashOf = (ones: number) => "1".repeat(ones) + "0".repeat(105 - ones);

let clockMs = 0;
const QUAD = [1, 1, 31, 1, 31, 43, 1, 43];

async function setup(opts: {
  respond?: () => CardFlowNormalizedRecognitionResult;
  consent?: boolean;
  limits?: Partial<typeof LIVE_CARDSIGHT_DEFAULTS>;
  enabled?: boolean;
  inHouse?: { tcgdexId: string; similarity: number; second: number };
  delayMs?: number;
  metrics?: OpsMetrics;
  regions?: boolean;
  premium?: boolean;
} = {}) {
  clockMs = Date.parse("2026-10-21T12:00:00.000Z");
  const store = createMemoryStore();
  store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-21T00:00:00.000Z");
  const respond = opts.respond ?? (() => result([{ confidence: "High" }]));
  const cs = fakeCardSight(
    opts.delayMs ? () => new Promise((r) => setTimeout(() => r(respond()), opts.delayMs)) as never : respond,
  );
  const ih = opts.inHouse;
  const openclip = ih
    ? {
        name: "openclip_hnsw" as const,
        matchCropJpeg: async () => ({
          pipeline: "openclip_hnsw" as const,
          accepted: true,
          tcgdexId: ih.tcgdexId,
          similarity: ih.similarity,
          candidates: [
            { tcgdexId: ih.tcgdexId, similarity: ih.similarity },
            { tcgdexId: "base1-1", similarity: ih.second },
          ],
          warped: false,
          timings: { totalMs: 40 },
        }),
      }
    : null;
  const alerts: OpsAlert[] = [];
  const app = createApp(store, {
    cardSight: cs.provider,
    livestreamCardSight: true,
    ...(openclip ? { liveIdentityOpenclip: openclip as never } : {}),
    liveCardSightLimits: { ...LIVE_CARDSIGHT_DEFAULTS, perUserDaily: 100, ...opts.limits },
    liveMaskRegions: opts.regions ? WHATNOT_OVERLAY_REGIONS : [],
    now: () => new Date(clockMs),
    opsMetrics: opts.metrics ?? new OpsMetrics([(a) => alerts.push(a)]),
    ...(opts.enabled === false ? { livestreamEnabled: () => false } : {}),
  });
  if (opts.consent ?? true) {
    const res = await app.request("/v1/consents/cardsight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ granted: true, version: CARDSIGHT_CONSENT_VERSION }),
    });
    expect(res.status).toBe(200);
  }
  // First frame of the scanner session (no card): starts the server-side session clock.
  await frame(app, { cardDetected: false, advance: 0 });
  return { app, store, cs, alerts };
}

async function frame(app: ReturnType<typeof createApp>, extra: Record<string, unknown> = {}) {
  const { advance = 2000, ...rest } = extra as { advance?: number };
  clockMs += advance as number;
  extra = rest;
  const res = await app.request("/v1/livestream/identify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "live_video",
      platform: "ios",
      cardDetected: true,
      identityHash: hashOf(0),
      identityCropJpeg: cropB64(),
      identityCropQuad: QUAD,
      ...extra,
    }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("Live Scan: automatic CardSight identify (Sean Oct 21)", () => {
  it("High confidence shows the card automatically, with no pick-one candidates", async () => {
    const { app, cs } = await setup();
    const { status, body } = await frame(app);
    expect(status).toBe(200);
    expect(cs.calls).toHaveLength(1);
    expect(body.identity.reason).toBe("identified");
    expect(body.identity.tcgdexId).toEqual(expect.any(String));
    expect(body.identity.confidence).toBe("High");
    expect(body.candidates).toBeUndefined();
    expect(body.similarity).toBeUndefined();
  });

  it("Medium is shown; Low shows nothing and retries on the next frame", async () => {
    let conf: "Medium" | "Low" = "Low";
    const { app, cs } = await setup({ respond: () => result([{ confidence: conf }]) });
    const low = await frame(app);
    expect(low.body.identity).toMatchObject({ tcgdexId: null, confidence: null, reason: "unidentified" });
    expect(low.body.retry).toBe(true);
    // One CardSight call per card: the same card is not re-sent after a Low answer.
    await frame(app);
    expect(cs.calls).toHaveLength(1);
    conf = "Medium";
    const med = await frame(app, { identityHash: hashOf(60) });
    expect(cs.calls).toHaveLength(2);
    expect(med.body.identity).toMatchObject({ reason: "identified", confidence: "Medium" });
  });

  it("multi-card and non-English: nothing shown, quiet one-card hint", async () => {
    const multi = await setup({ respond: () => result([{}, {}]) });
    const m = await frame(multi.app);
    expect(m.body.identity.tcgdexId).toBeNull();
    expect(m.body.hint).toBe("one_card_at_a_time");
    const ja = await setup({ respond: () => result([{ language: "ja", confidence: "High" }]) });
    const j = await frame(ja.app);
    expect(j.body.identity.tcgdexId).toBeNull();
    expect(j.body.hint).toBe("one_card_at_a_time");
  });

  it("the same card still in view is not re-sent", async () => {
    const { app, cs } = await setup();
    await frame(app);
    const again = await frame(app, { identityHash: hashOf(4) });
    expect(cs.calls).toHaveLength(1);
    expect(again.body.identity.reason).toBe("identified");
    await frame(app, { identityHash: hashOf(60) });
    expect(cs.calls).toHaveLength(2);
  });

  it("hybrid: a confident in-house match is shown at once and CardSight is not called", async () => {
    const { app, cs } = await setup({ inHouse: { tcgdexId: "swsh3-136", similarity: 0.9, second: 0.85 } });
    const first = await frame(app, { cardAgeMs: 300, advance: 300 });
    expect(first.body.identity.tcgdexId).toBeNull(); // 1 of 3 frames so far
    const r = await frame(app, { cardAgeMs: 600, advance: 300 });
    expect(cs.calls).toHaveLength(0);
    expect(r.body.identity.confidence).toBeNull(); // our matcher has no CardSight tier
    expect(r.body.tier).toBe("in_house_confident");
    expect(r.body.identity).toMatchObject({ tcgdexId: "swsh3-136", reason: "identified" });
    expect(r.body.engine).toBe("in_house");
    expect(r.body.candidates).toBeUndefined();
  });

  it("hybrid: an unsure in-house match goes straight to CardSight (one call per card)", async () => {
    const { app, cs } = await setup({ inHouse: { tcgdexId: "swsh3-136", similarity: 0.85, second: 0.84 } });
    const r = await frame(app);
    expect(cs.calls).toHaveLength(1);
    expect(r.body.engine).toBe("cardsight");
    await frame(app);
    expect(cs.calls).toHaveLength(1);
  });

  it("comparison is aggregate counters only: no per-scan log lines, no card ids", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const metrics = new OpsMetrics();
    const { app } = await setup({ metrics });
    await frame(app);
    const logged = info.mock.calls.map((c) => String(c[0]));
    info.mockRestore();
    expect(logged.filter((l) => /livestream-(engine|compare)/.test(l))).toEqual([]);
    expect(metrics.liveEngine.cardsight).toBe(1);
    expect(JSON.stringify(metrics.liveEngine)).not.toMatch(/[a-z]+\d*-\d+/);
  });

  it("past the monthly trial cap, Live Scan falls back to in-house only (no cut-off)", async () => {
    const { app, cs } = await setup({ limits: { trialMonthly: 1 } });
    await frame(app, { identityHash: hashOf(0) });
    const capped = await frame(app, { identityHash: hashOf(60) });
    expect(cs.calls).toHaveLength(1);
    expect(capped.status).toBe(200);
    expect(capped.body.limited).toBe("user_monthly");
  });

  it("a slow CardSight answer is dropped at the deadline (time budget)", async () => {
    const { app } = await setup({ delayMs: 400, limits: { deadlineMs: 50 } });
    const started = Date.now();
    const r = await frame(app);
    expect(Date.now() - started).toBeLessThan(350);
    expect(r.body.identity.tcgdexId).toBeNull();
  });

  it("in-house alone for the first 1.5 s; one CardSight call after; nothing after 7 s", async () => {
    const { app, cs } = await setup({ respond: () => result([{ confidence: "Low" }]) });
    const early = await frame(app, { cardAgeMs: 600 });
    expect(cs.calls).toHaveLength(0);
    expect(early.body.retry).toBe(true);
    await frame(app, { cardAgeMs: 1600 });
    expect(cs.calls).toHaveLength(1);
    await frame(app, { cardAgeMs: 3000 });
    expect(cs.calls).toHaveLength(1);
    const late = await frame(app, { cardAgeMs: 7200, identityHash: hashOf(60), advance: 8000 });
    expect(cs.calls).toHaveLength(1);
    expect(late.body.identity.tcgdexId).toBeNull();
    expect(late.body.retry).toBe(false);
  });

  it("fails closed: no card corners (or no frame position when overlay masking is on) = no CardSight call", async () => {
    const a = await setup();
    const r = await frame(a.app, { identityCropQuad: null });
    expect(a.cs.calls).toHaveLength(0);
    expect(r.body.mask).toBe("unavailable");
    const b = await setup({ regions: true });
    await frame(b.app, { cardBox: null });
    expect(b.cs.calls).toHaveLength(0);
    await frame(b.app, { cardBox: { x: 0.2, y: 0.1, width: 0.5, height: 0.4 } });
    expect(b.cs.calls).toHaveLength(1);
  });

  it("the phone's cardAgeMs is clamped to the server-side session", async () => {
    const { app, cs } = await setup();
    // Session is 300 ms old: a claimed 5 s card age can't skip our matcher's 1.5 s window.
    await frame(app, { cardAgeMs: 5000, advance: 300 });
    expect(cs.calls).toHaveLength(0);
  });

  it("meters are taken before the call; a timeout stays counted, a non-billed error is refunded", async () => {
    const slow = await setup({ delayMs: 400, limits: { deadlineMs: 50 } });
    await frame(slow.app);
    expect(slow.store.getVendorQuotaUsage("cardsight", "2026-10")).toBe(1);
    const failing = await setup({
      respond: () => ({ ...result([]), ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "down", retryable: true } }),
    });
    await frame(failing.app);
    expect(failing.cs.calls).toHaveLength(1);
    expect(failing.store.getVendorQuotaUsage("cardsight", "2026-10")).toBe(0);
  });

  it("Live Scan stops at its share of the global monthly meter (Scan a Card keeps its reserve)", async () => {
    const { app, cs, store } = await setup({ limits: { globalMonthly: 1 } });
    await frame(app, { identityHash: hashOf(0) });
    const capped = await frame(app, { identityHash: hashOf(60) });
    expect(cs.calls).toHaveLength(1);
    expect(capped.body.limited).toBe("global_monthly");
    expect(store.getVendorQuotaUsage("cardsight", "2026-10")).toBe(1);
  });

  it("no card in frame / CardSight turned off: CardSight is never called", async () => {
    const a = await setup();
    await frame(a.app, { cardDetected: false });
    expect(a.cs.calls).toHaveLength(0);
    const b = await setup({ consent: false });
    const r = await frame(b.app);
    expect(b.cs.calls).toHaveLength(0);
    expect(r.body.identity.tcgdexId).toBeNull();
  });

  it("per-session rate limit", async () => {
    const { app, cs } = await setup({ limits: { perSessionPerMinute: 2 } });
    for (let i = 0; i < 3; i++) await frame(app, { identityHash: hashOf(i * 30) });
    expect(cs.calls).toHaveLength(2);
  });

  it("per-user and app-wide daily caps, with 50/75/90% alerts", async () => {
    const user = await setup({ limits: { perUserDaily: 1 } });
    await frame(user.app, { identityHash: hashOf(0) });
    const capped = await frame(user.app, { identityHash: hashOf(60) });
    expect(user.cs.calls).toHaveLength(1);
    expect(capped.body.limited).toBe("user_daily");

    const g = await setup({ limits: { globalDaily: 4 } });
    for (let i = 0; i < 5; i++) await frame(g.app, { identityHash: hashOf(i * 20), sessionId: `s${i}` });
    expect(g.cs.calls).toHaveLength(4);
    expect(g.alerts.map((a) => a.kind)).toEqual([
      "cardsight_live_daily_50",
      "cardsight_live_daily_75",
      "cardsight_live_daily_90",
    ]);
  });

  it("the crop sent is masked (Whatnot chat region blacked out)", async () => {
    const { app, cs } = await setup({ regions: true });
    await frame(app, { cardBox: { x: 0, y: 0.5, width: 0.5, height: 0.5 } });
    const sent = jpeg.decode(cs.calls[0]!.image, { useTArray: true });
    expect(sent.data[(40 * 32 + 16) * 4]!).toBeLessThan(40);
  });

  it("CARD_FLOW_LIVESTREAM_ENABLED off switch still wins", async () => {
    const { app, cs } = await setup({ enabled: false });
    const r = await frame(app);
    expect(r.status).toBe(503);
    expect(cs.calls).toHaveLength(0);
  });
});
