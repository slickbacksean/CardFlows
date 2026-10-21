import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
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
import { LIVE_CARDSIGHT_DEFAULTS } from "./livestream-cardsight";
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

async function setup(opts: {
  respond?: () => CardFlowNormalizedRecognitionResult;
  consent?: boolean;
  limits?: Partial<typeof LIVE_CARDSIGHT_DEFAULTS>;
  enabled?: boolean;
} = {}) {
  const store = createMemoryStore();
  store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-21T00:00:00.000Z");
  const cs = fakeCardSight(opts.respond ?? (() => result([{ confidence: "High" }])));
  const alerts: OpsAlert[] = [];
  const app = createApp(store, {
    cardSight: cs.provider,
    livestreamCardSight: true,
    liveCardSightLimits: { ...LIVE_CARDSIGHT_DEFAULTS, ...opts.limits },
    opsMetrics: new OpsMetrics([(a) => alerts.push(a)]),
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
  return { app, store, cs, alerts };
}

async function frame(app: ReturnType<typeof createApp>, extra: Record<string, unknown> = {}) {
  const res = await app.request("/v1/livestream/identify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "live_video",
      platform: "ios",
      cardDetected: true,
      identityHash: hashOf(0),
      identityCropJpeg: cropB64(),
      sessionId: "s1",
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
    conf = "Medium";
    const med = await frame(app);
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

  it("no card in frame / no consent: CardSight is never called", async () => {
    const a = await setup();
    await frame(a.app, { cardDetected: false });
    expect(a.cs.calls).toHaveLength(0);
    const b = await setup({ consent: false });
    const r = await frame(b.app);
    expect(b.cs.calls).toHaveLength(0);
    expect(r.body.cardSight).toBe("consent_required");
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
    const { app, cs } = await setup();
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
