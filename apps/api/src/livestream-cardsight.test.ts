import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { identifyCardMock } from "@cardflow/shared/mock";
import type { CardFlowNormalizedRecognitionResult } from "@cardflow/shared";
import {
  createLiveCardSightGate,
  inHouseConfident,
  LIVE_INHOUSE_GATE_DEFAULTS,
  liveInHouseGateFromEnv,
  LIVE_CARDSIGHT_DEFAULTS,
  liveCardSightAlertLevel,
  liveCardSightEnabledFromEnv,
  liveCardSightLimitsFromEnv,
  liveCardSightVerdict,
  maskLiveCrop,
} from "./livestream-cardsight";
import { OpsMetrics } from "./ops-metrics";
import { LIVE_SCAN_CARDSIGHT_DEADLINE_MS, LIVE_SCAN_HANDOFF_MS, LIVE_SCAN_ID_BUDGET_MS, liveScanWorstCaseMs } from "@cardflow/shared";

const base = identifyCardMock("high-confidence");
function withDetections(dets: Array<Partial<CardFlowNormalizedRecognitionResult["detections"][number]>>) {
  return { ...base, detections: dets.map((d) => ({ ...base.detections[0]!, ...d })) } as CardFlowNormalizedRecognitionResult;
}

describe("Live Scan CardSight verdict (never a guess)", () => {
  it("shows only Medium or High", () => {
    expect(liveCardSightVerdict(withDetections([{ confidence: "High" }])).kind).toBe("identified");
    expect(liveCardSightVerdict(withDetections([{ confidence: "Medium" }])).kind).toBe("identified");
    expect(liveCardSightVerdict(withDetections([{ confidence: "Low" }])).kind).toBe("low");
    expect(liveCardSightVerdict(withDetections([{ confidence: null }])).kind).toBe("low");
    expect(liveCardSightVerdict(withDetections([])).kind).toBe("none");
  });
  it("multi-card and non-English are never shown", () => {
    expect(liveCardSightVerdict(withDetections([{}, {}])).kind).toBe("multi_card");
    expect(liveCardSightVerdict(withDetections([{ language: "ja", confidence: "High" }])).kind).toBe("non_english");
    expect(liveCardSightVerdict(withDetections([{ language: "en", confidence: "High" }])).kind).toBe("identified");
  });
});

describe("Live Scan CardSight limits", () => {
  it("defaults and env overrides", () => {
    expect(liveCardSightLimitsFromEnv({})).toEqual(LIVE_CARDSIGHT_DEFAULTS);
    expect(
      liveCardSightLimitsFromEnv({
        CARD_FLOW_LIVE_CARDSIGHT_USER_DAILY: "10",
        CARD_FLOW_LIVE_CARDSIGHT_GLOBAL_DAILY: "200",
        CARD_FLOW_LIVE_CARDSIGHT_SESSION_PER_MIN: "2",
        CARD_FLOW_LIVE_CARDSIGHT_DEDUPE_SECONDS: "30",
      }),
    ).toMatchObject({ perUserDaily: 10, globalDaily: 200, perSessionPerMinute: 2, dedupeMs: 30_000 });
    // One plan setting drives every cap: free 750/month by default, scales up automatically.
    expect(liveCardSightLimitsFromEnv({})).toMatchObject({
      globalMonthly: 562, globalDaily: 19, perUserDaily: 3, premiumMonthly: 56, trialMonthly: 11, giveUpMs: 7000,
    });
    expect(liveCardSightLimitsFromEnv({ CARD_FLOW_CARDSIGHT_PLAN_MONTHLY: "100000" })).toMatchObject({
      globalMonthly: 75000, globalDaily: 2500, perUserDaily: 150, premiumMonthly: 1000, trialMonthly: 200,
    });
    expect(liveCardSightLimitsFromEnv({ CARD_FLOW_LIVE_SCAN_BUDGET_MS: "6000" }).giveUpMs).toBe(6000);
    expect(liveCardSightEnabledFromEnv({})).toBe(true);
    expect(liveCardSightEnabledFromEnv({ CARD_FLOW_LIVESTREAM_CARDSIGHT: "off" })).toBe(false);
  });

  it("alert levels 50/75/90", () => {
    expect(liveCardSightAlertLevel(49, 100)).toBe(0);
    expect(liveCardSightAlertLevel(50, 100)).toBe(50);
    expect(liveCardSightAlertLevel(80, 100)).toBe(75);
    expect(liveCardSightAlertLevel(95, 100)).toBe(90);
  });

  it("ops alerts once per level per day", () => {
    const sink: string[] = [];
    const m = new OpsMetrics([(a) => sink.push(a.kind)], () => 0);
    m.recordLiveCardSightDailyUsage(40, 100, "2026-10-21");
    m.recordLiveCardSightDailyUsage(50, 100, "2026-10-21");
    m.recordLiveCardSightDailyUsage(51, 100, "2026-10-21");
    m.recordLiveCardSightDailyUsage(75, 100, "2026-10-21");
    m.recordLiveCardSightDailyUsage(90, 100, "2026-10-21");
    expect(sink).toEqual(["cardsight_live_daily_50", "cardsight_live_daily_75", "cardsight_live_daily_90"]);
  });

  it("session rate limit and same-card de-dupe", () => {
    let t = 0;
    const gate = createLiveCardSightGate({ ...LIVE_CARDSIGHT_DEFAULTS, perSessionPerMinute: 2 }, () => t);
    expect(gate.takeSessionSlot("u:s")).toBe(true);
    expect(gate.takeSessionSlot("u:s")).toBe(true);
    expect(gate.takeSessionSlot("u:s")).toBe(false);
    t = 61_000;
    expect(gate.takeSessionSlot("u:s")).toBe(true);

    const hash = "0".repeat(105);
    const near = "1".repeat(5) + "0".repeat(100);
    gate.remember("u", `hash:${hash}`, { tcgdexId: "base1-58", confidence: "High", hint: null });
    expect(gate.recall("u", `hash:${near}`)?.tcgdexId).toBe("base1-58");
    expect(gate.recall("other", `hash:${hash}`)).toBeNull();
    expect(gate.recall("u", `hash:${"1".repeat(105)}`)).toBeNull();
    t += LIVE_CARDSIGHT_DEFAULTS.dedupeMs;
    expect(gate.recall("u", `hash:${hash}`)).toBeNull();
  });
});

describe("maskLiveCrop", () => {
  const W = 40;
  const H = 40;
  const white = () => {
    const data = new Uint8Array(W * H * 4).fill(255);
    return new Uint8Array(jpeg.encode({ width: W, height: H, data }, 95).data);
  };
  const px = (bytes: Uint8Array, x: number, y: number) => {
    const img = jpeg.decode(bytes, { useTArray: true });
    return img.data[(y * W + x) * 4]!;
  };

  it("blacks out everything outside the card corners", () => {
    const out = maskLiveCrop(white(), { quad: [10, 10, 30, 10, 30, 30, 10, 30] })!;
    expect(px(out, 2, 2)).toBeLessThan(40);
    expect(px(out, 20, 20)).toBeGreaterThan(200);
  });

  it("blacks out Whatnot chat / bid regions in frame space", () => {
    // Crop covers the lower-left of the frame: its lower half sits in the chat region.
    const out = maskLiveCrop(white(), { cropInFrame: { x: 0.1, y: 0.3, width: 0.4, height: 0.5 } })!;
    expect(px(out, 20, 5)).toBeGreaterThan(200); // frame y ~0.31: clear
    expect(px(out, 20, 35)).toBeLessThan(40); // frame y ~0.74: chat
  });

  it("returns null for bytes that are not a JPEG", () => {
    expect(maskLiveCrop(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("hybrid in-house gate + time budget", () => {
  it("in-house answers alone only above the tuned threshold", () => {
    const g = LIVE_INHOUSE_GATE_DEFAULTS;
    expect(g).toEqual({ minSimilarity: 0.86, minMargin: 0.02 });
    const c = (a: number, b: number) => [{ tcgdexId: "x-1", similarity: a }, { tcgdexId: "y-2", similarity: b }];
    expect(inHouseConfident({ tcgdexId: "x-1", candidates: c(0.89, 0.86) }, g)).toBe(true);
    expect(inHouseConfident({ tcgdexId: "x-1", candidates: c(0.87, 0.86) }, g)).toBe(false); // ambiguous
    expect(inHouseConfident({ tcgdexId: "x-1", candidates: c(0.85, 0.7) }, g)).toBe(false); // too low
    expect(inHouseConfident({ tcgdexId: null, candidates: c(0.9, 0.7) }, g)).toBe(false);
    expect(liveInHouseGateFromEnv({ CARD_FLOW_LIVE_INHOUSE_MIN_SIMILARITY: "0.9" }).minSimilarity).toBe(0.9);
  });

  it("worst case card-appears-to-result fits the 7 s budget", () => {
    expect(LIVE_SCAN_ID_BUDGET_MS).toBe(7000);
    expect(liveScanWorstCaseMs()).toBeLessThanOrEqual(LIVE_SCAN_ID_BUDGET_MS);
    expect(LIVE_CARDSIGHT_DEFAULTS.deadlineMs).toBe(LIVE_SCAN_CARDSIGHT_DEADLINE_MS);
    expect(LIVE_CARDSIGHT_DEFAULTS.handoffMs).toBe(LIVE_SCAN_HANDOFF_MS);
    expect(LIVE_CARDSIGHT_DEFAULTS.giveUpMs).toBe(LIVE_SCAN_ID_BUDGET_MS);
  });
});
