import { describe, expect, it } from "vitest";
import {
  ENGLISH_CARDS_ONLY_NOTE,
  MULTI_CARD_SCAN_MAX,
  type CardRecognitionProvider,
  type IdentifyCardRequest,
} from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { createMemoryStore } from "./store";

type App = ReturnType<typeof createApp>;

async function json<T>(
  app: App,
  pathName: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const response = await app.request(pathName, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return { status: response.status, body: (await response.json()) as T };
}

function multiRecognitionProvider(): CardRecognitionProvider {
  return {
    name: "mock",
    async identifyCard(_req: IdentifyCardRequest) {
      const base = identifyCardMock("high-confidence");
      return {
        ...base,
        provider: "mock",
        detections: [
          base.detections[0]!,
          {
            confidence: "High",
            matchLevel: "exact",
            vendorCardId: "char-en",
            name: "Charizard",
            setName: "Base Set",
            number: "4",
            language: "en",
            fields: [{ key: "CARD_LANGUAGE", value: "en" }],
            candidates: [],
          },
          {
            confidence: "High",
            matchLevel: "exact",
            vendorCardId: "pika-ja",
            name: "ピカチュウ",
            setName: "Base Set",
            number: "58",
            language: "ja",
            fields: [{ key: "CARD_LANGUAGE", value: "ja" }],
            candidates: [],
          },
        ],
        _meta: undefined,
      };
    },
  };
}

describe("multi-card scan + English-only", () => {
  it("returns cardResults for every detection and flags Japanese", async () => {
    const app = createApp(createMemoryStore(), {
      recognition: multiRecognitionProvider(),
      allowDevScenario: true,
    });
    const created = await json<{
      scan: {
        scanId: string;
        cardResults: Array<{
          index: number;
          notice: string | null;
          countsTowardAllowance: boolean;
          mapping: { status: string; tcgdexId: string | null };
        }>;
        recognition: { detections: unknown[] };
      };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(created.status).toBe(201);
    expect(created.body.scan.recognition.detections.length).toBeLessThanOrEqual(MULTI_CARD_SCAN_MAX);
    expect(created.body.scan.cardResults).toHaveLength(3);
    expect(created.body.scan.cardResults[2]?.notice).toBe(ENGLISH_CARDS_ONLY_NOTE);
    expect(created.body.scan.cardResults[2]?.countsTowardAllowance).toBe(false);
    expect(created.body.scan.cardResults[2]?.mapping.tcgdexId).toBeNull();
  });

  it("lets the user skip a Japanese card without confirming", async () => {
    const app = createApp(createMemoryStore(), {
      recognition: multiRecognitionProvider(),
      allowDevScenario: true,
    });
    const created = await json<{ scan: { scanId: string } }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    const skip = await json<{
      scan: { cardResults: Array<{ state: string; index: number }> };
    }>(app, `/v1/scans/${created.body.scan.scanId}/cards/2/skip`, { method: "POST" });
    expect(skip.status).toBe(200);
    expect(skip.body.scan.cardResults[2]?.state).toBe("skipped");

    const confirmJa = await json<{ ok: boolean; error?: string }>(
      app,
      `/v1/scans/${created.body.scan.scanId}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ tcgdexId: "base1-58", detectionIndex: 2 }),
      },
    );
    expect(confirmJa.status).toBe(400);
    expect(confirmJa.body.error).toBe(ENGLISH_CARDS_ONLY_NOTE);
  });

  it("confirms an English card by detectionIndex", async () => {
    const app = createApp(createMemoryStore(), {
      recognition: multiRecognitionProvider(),
      allowDevScenario: true,
    });
    const created = await json<{
      scan: {
        scanId: string;
        cardResults: Array<{ mapping: { tcgdexId: string | null } }>;
      };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    const tcgdexId = created.body.scan.cardResults[0]?.mapping.tcgdexId ?? "base1-58";
    const confirmed = await json<{
      scan: {
        cardResults: Array<{
          state: string;
          cardflowCardId: string | null;
          confirmationId: string | null;
        }>;
      };
      canonicalCard: { tcgdexId: string };
    }>(app, `/v1/scans/${created.body.scan.scanId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ tcgdexId, detectionIndex: 0 }),
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.canonicalCard.tcgdexId).toBe(tcgdexId);
    expect(confirmed.body.scan.cardResults[0]?.state).toBe("confirmed");
    expect(confirmed.body.scan.cardResults[0]?.cardflowCardId).toBeTruthy();
    expect(confirmed.body.scan.cardResults[0]?.confirmationId).toBeTruthy();
  });

  it("keeps cardflowCardId on each confirmed row after skipping the rest", async () => {
    const app = createApp(createMemoryStore(), {
      recognition: multiRecognitionProvider(),
      allowDevScenario: true,
    });
    const created = await json<{
      scan: {
        scanId: string;
        cardResults: Array<{ mapping: { tcgdexId: string | null } }>;
      };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    const tcgdexId = created.body.scan.cardResults[0]?.mapping.tcgdexId ?? "base1-58";
    await json(app, `/v1/scans/${created.body.scan.scanId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ tcgdexId, detectionIndex: 0 }),
    });
    // Skip English Charizard and Japanese Pikachu
    await json(app, `/v1/scans/${created.body.scan.scanId}/cards/1/skip`, { method: "POST" });
    const skipJa = await json<{
      scan: {
        cardResults: Array<{ state: string; cardflowCardId: string | null }>;
      };
    }>(app, `/v1/scans/${created.body.scan.scanId}/cards/2/skip`, { method: "POST" });
    expect(skipJa.status).toBe(200);
    expect(skipJa.body.scan.cardResults.map((r) => r.state)).toEqual([
      "confirmed",
      "skipped",
      "skipped",
    ]);
    expect(skipJa.body.scan.cardResults[0]?.cardflowCardId).toBeTruthy();
    expect(skipJa.body.scan.cardResults.every((r) => r.state !== "pending")).toBe(true);
  });
});
