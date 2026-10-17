import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMockCardRecognitionProvider } from "@cardflow/shared";
import { describe, expect, it, vi } from "vitest";
import {
  cardSightAdapterFromEnv,
  createCardSightRecognitionProvider,
  createRecognitionWithFallback,
} from "./cardsight-adapter";
import { resolveRecognitionSelection } from "./recognition-env";

const dir = path.dirname(fileURLToPath(import.meta.url));
const wire = (name: string) => JSON.parse(readFileSync(path.join(dir, "fixtures", name), "utf8")) as unknown;
const req = { image: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" as const };
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => {};

describe("P1-05 CardSight adapter (recorded responses)", () => {
  it("maps a high-confidence exact match and sends the key only as a header", async () => {
    const fetchMock = vi.fn(async () => json(200, wire("cardsight-wire-high.json")));
    const provider = createCardSightRecognitionProvider({ apiKey: "k", fetch: fetchMock as never, sleep: noSleep });
    const result = await provider.identifyCard(req);
    expect(result).toMatchObject({ provider: "cardsight", ok: true, vendorRequestId: "req_wire_high_001", processingTimeMs: 412 });
    expect(result.detections[0]).toMatchObject({ confidence: "High", name: "Pikachu", setName: "Base Set", number: "58" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cardsight.ai/v1/identify/card");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("k");
  });

  it("maps suggestions into ranked candidates", async () => {
    const provider = createCardSightRecognitionProvider({ apiKey: "k", fetch: (async () => json(200, wire("cardsight-wire-ambiguous.json"))) as never });
    const det = (await provider.identifyCard(req)).detections[0]!;
    expect(det.confidence).toBe("Medium");
    expect(det.candidates.map((c) => c.setName)).toEqual(["Base Set 2", "Legendary Collection"]);
  });

  it("retries 5xx/408 up to twice, never 401/4xx", async () => {
    const flaky = vi.fn().mockResolvedValueOnce(json(503)).mockResolvedValueOnce(json(408)).mockResolvedValueOnce(json(200, wire("cardsight-wire-high.json")));
    const ok = await createCardSightRecognitionProvider({ apiKey: "k", fetch: flaky as never, sleep: noSleep }).identifyCard(req);
    expect(ok.ok).toBe(true);
    expect(flaky).toHaveBeenCalledTimes(3);

    const down = vi.fn(async () => json(500));
    const failed = await createCardSightRecognitionProvider({ apiKey: "k", fetch: down as never, sleep: noSleep }).identifyCard(req);
    expect(down).toHaveBeenCalledTimes(3);
    expect(failed.error).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });

    const onAlert = vi.fn();
    const auth = vi.fn(async () => json(401));
    const denied = await createCardSightRecognitionProvider({ apiKey: "bad", fetch: auth as never, sleep: noSleep, onAlert }).identifyCard(req);
    expect(auth).toHaveBeenCalledTimes(1);
    expect(denied.error?.code).toBe("PROVIDER_AUTH");
    expect(onAlert).toHaveBeenCalledWith({ code: "PROVIDER_AUTH", httpStatus: 401 });

    const limited = vi.fn(async () => json(429));
    expect((await createCardSightRecognitionProvider({ apiKey: "k", fetch: limited as never, sleep: noSleep }).identifyCard(req)).error?.code).toBe("RATE_LIMITED");
    expect(limited).toHaveBeenCalledTimes(1);
  });

  it("times out each attempt at 3 s by default (abort)", async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    const result = await createCardSightRecognitionProvider({ apiKey: "k", fetch: hang as never, timeoutMs: 5, sleep: noSleep }).identifyCard(req);
    expect(hang).toHaveBeenCalledTimes(3);
    expect(result.error?.code).toBe("PROVIDER_TIMEOUT");
  });

  it("quota exhausted → no call, alert, and the fallback answers", async () => {
    const fetchMock = vi.fn();
    const onAlert = vi.fn();
    const onFallback = vi.fn();
    const primary = createCardSightRecognitionProvider({ apiKey: "k", fetch: fetchMock as never, consumeBudget: () => false, onAlert });
    const provider = createRecognitionWithFallback(primary, createMockCardRecognitionProvider({ defaultScenario: "high-confidence" }), onFallback);
    const result = await provider.identifyCard(req);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onAlert).toHaveBeenCalledWith({ code: "QUOTA_EXCEEDED" });
    expect(onFallback).toHaveBeenCalledWith("QUOTA_EXCEEDED");
    expect(result.ok).toBe(true);
  });

  it("is off unless explicitly enabled with a key, and env selection never picks CardSight", () => {
    expect(cardSightAdapterFromEnv({})).toBeNull();
    expect(cardSightAdapterFromEnv({ CARDSIGHT_API_KEY: "k" })).toBeNull();
    expect(cardSightAdapterFromEnv({ CARD_FLOW_CARDSIGHT_ADAPTER: "on" })).toBeNull();
    expect(cardSightAdapterFromEnv({ CARD_FLOW_CARDSIGHT_ADAPTER: "on", CARDSIGHT_API_KEY: "k" })?.name).toBe("cardsight");
    expect(resolveRecognitionSelection({ CARD_FLOW_CARDSIGHT_ADAPTER: "on", CARDSIGHT_API_KEY: "k" }).kind).not.toBe("cardsight");
  });
});

describe("CardSight adapter backend review", () => {
  const run = (body: string) =>
    createCardSightRecognitionProvider({
      apiKey: "k",
      fetch: (async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })) as never,
      sleep: noSleep,
    }).identifyCard(req);

  it("success:false, a broken body, or non-array detections is an error", async () => {
    for (const body of ['{"success":false,"error":{"message":"bad"}}', "not json", "[]", "null", '{"detections":{}}']) {
      const result = await run(body);
      expect(result.ok, body).toBe(false);
      expect(result.error?.code).toBe("PROVIDER_UNAVAILABLE");
    }
  });

  it("falls back when CardSight answers success:false", async () => {
    const primary = createCardSightRecognitionProvider({ apiKey: "k", fetch: (async () => json(200, { success: false })) as never });
    const onFallback = vi.fn();
    await createRecognitionWithFallback(primary, createMockCardRecognitionProvider(), onFallback).identifyCard(req);
    expect(onFallback).toHaveBeenCalledWith("PROVIDER_UNAVAILABLE");
  });

  it("a missing matchLevel is null, not 'exact'", async () => {
    const result = await run(JSON.stringify({ detections: [{ confidence: "high", card: { name: "Pikachu" } }] }));
    expect(result.ok).toBe(true);
    expect(result.detections[0]!.matchLevel).toBeNull();
  });
});
