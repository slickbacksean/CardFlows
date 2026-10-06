import { describe, expect, it } from "vitest";
import {
  CatalogProviderError,
  mockCardRecognitionProvider,
  mockTcgdexCatalogProvider,
  stillIdentifySkippedResult,
  type CardRecognitionProvider,
  type IdentifyCardRequest,
} from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { createMemoryStore, type StorePort } from "./store";
import { SCAN_IMAGE_MAX_BYTES } from "./scan-image";

type App = ReturnType<typeof createApp>;

const TINY_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const STORED_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);

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

function jpegFile(bytes: Uint8Array = TINY_JPEG) {
  return new File([bytes], "still.jpg", { type: "image/jpeg" });
}

async function postScanWithImage(app: App, file: File) {
  const form = new FormData();
  form.append("captureMethod", "camera_photo");
  form.append("scenario", "high-confidence");
  form.append("image", file);
  return app.request("/v1/scans", { method: "POST", body: form });
}

function spyRecognition(): {
  calls: IdentifyCardRequest[];
  recognition: CardRecognitionProvider;
} {
  const calls: IdentifyCardRequest[] = [];
  return {
    calls,
    recognition: {
      name: "mock",
      async identifyCard(req) {
        calls.push(req);
        return {
          ...identifyCardMock("high-confidence"),
          provider: "mock",
          _meta: undefined,
        };
      },
    },
  };
}

describe("CardRecognitionProvider on POST /v1/scans", () => {
  it("reports mock recognition on /health", async () => {
    const app = createApp(createMemoryStore(), {
      recognition: mockCardRecognitionProvider,
    });
    const health = await json<{
      ok: boolean;
      recognition: string;
      pricingProvider: string;
    }>(app, "/health");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      ok: true,
      recognition: "mock",
      pricingProvider: "off",
    });
  });

  it("uses fixture identify for DEV scenario chips when live is off", async () => {
    const app = createApp(createMemoryStore());
    const high = await json<{
      scan: {
        cardflowCardId: string | null;
        inventoryItemId: string | null;
        recognition: { provider: string; ok: boolean; detections: Array<{ name: string | null }> };
      };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(high.status).toBe(201);
    expect(high.body.scan.cardflowCardId).toBeNull();
    expect(high.body.scan.inventoryItemId).toBeNull();
    expect(high.body.scan.recognition.provider).toBe("mock");
    expect(high.body.scan.recognition.ok).toBe(true);
    expect(high.body.scan.recognition.detections[0]?.name).toBe("Pikachu");

    const ambiguous = await json<{
      scan: { recognition: { detections: Array<{ name: string | null; candidates: unknown[] }> } };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "manual_scan", scenario: "ambiguous" }),
    });
    expect(ambiguous.status).toBe(201);
    expect(ambiguous.body.scan.recognition.detections[0]?.name).toBe("Charizard");
    expect(ambiguous.body.scan.recognition.detections[0]?.candidates.length).toBeGreaterThan(1);
  });

  it("calls the injected recognition provider instead of identifyCardMock", async () => {
    const calls: IdentifyCardRequest[] = [];
    const recognition: CardRecognitionProvider = {
      name: "mock",
      async identifyCard(req) {
        calls.push(req);
        return identifyCardMock("no-card");
      },
    };
    const app = createApp(createMemoryStore(), { recognition });
    const created = await json<{
      scan: { recognition: { detections: unknown[]; _meta?: { mocked?: boolean } } };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(created.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.scenario).toBe("high-confidence");
    expect(calls[0]?.mimeType).toBe("image/jpeg");
    expect(calls[0]?.image.byteLength).toBe(0);
    expect(created.body.scan.recognition.detections).toEqual([]);
    expect(created.body.scan.recognition._meta?.mocked).toBe(true);
  });

  it("skips live identify for JSON-only DEV chips and keeps the mock scenario", async () => {
    const { calls, recognition } = spyRecognition();
    const app = createApp(createMemoryStore(), {
      recognition,
      liveIdentifyEnabled: true,
    });
    const created = await json<{
      scan: {
        imageStorageRef: string | null;
        recognition: { provider: string; detections: Array<{ name: string | null }> };
      };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "ambiguous" }),
    });
    expect(created.status).toBe(201);
    expect(created.body.scan.imageStorageRef).toBeNull();
    expect(created.body.scan.recognition.provider).toBe("mock");
    expect(created.body.scan.recognition.detections[0]?.name).toBe("Charizard");
    expect(calls).toHaveLength(0);
  });

  it("live identify reads image_storage_ref bytes, not the request buffer", async () => {
    const inner = createMemoryStore();
    const store: StorePort = {
      ...inner,
      readStoredScanImage(scanId, storageRef) {
        return {
          storageRef,
          mimeType: "image/jpeg",
          bytes: STORED_JPEG,
        };
      },
    };
    const { calls, recognition } = spyRecognition();
    const app = createApp(store, { recognition, liveIdentifyEnabled: true });
    const response = await postScanWithImage(app, jpegFile(TINY_JPEG));
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      scan: { imageStorageRef: string; recognition: { provider: string } };
    };
    expect(body.scan.imageStorageRef).toMatch(/^scans\/.+\.jpg$/);
    expect(body.scan.recognition.provider).toBe("mock");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.scenario).toBeUndefined();
    expect(calls[0]?.mimeType).toBe("image/jpeg");
    expect(calls[0]?.image).toEqual(STORED_JPEG);
    expect(calls[0]?.image).not.toEqual(TINY_JPEG);
  });

  it("does not call the vendor when the stored still is missing or oversize", async () => {
    const missingStore: StorePort = {
      ...createMemoryStore(),
      readStoredScanImage() {
        return undefined;
      },
    };
    const missingSpy = spyRecognition();
    const missingApp = createApp(missingStore, {
      recognition: missingSpy.recognition,
      liveIdentifyEnabled: true,
    });
    const missing = await postScanWithImage(missingApp, jpegFile());
    expect(missing.status).toBe(201);
    expect(await missing.json()).toMatchObject({
      scan: {
        recognition: stillIdentifySkippedResult("missing_image"),
        cardflowCardId: null,
        inventoryItemId: null,
      },
    });
    expect(missingSpy.calls).toHaveLength(0);

    const oversizeStore: StorePort = {
      ...createMemoryStore(),
      readStoredScanImage(scanId, storageRef) {
        return {
          storageRef,
          mimeType: "image/jpeg",
          bytes: new Uint8Array(SCAN_IMAGE_MAX_BYTES + 1),
        };
      },
    };
    const oversizeSpy = spyRecognition();
    const oversizeApp = createApp(oversizeStore, {
      recognition: oversizeSpy.recognition,
      liveIdentifyEnabled: true,
    });
    const oversize = await postScanWithImage(oversizeApp, jpegFile());
    expect(oversize.status).toBe(201);
    expect(await oversize.json()).toMatchObject({
      scan: { recognition: stillIdentifySkippedResult("oversize_image") },
    });
    expect(oversizeSpy.calls).toHaveLength(0);
  });

  it("does not name Pikachu when scenario is ignored or the still is missing", async () => {
    const app = createApp(createMemoryStore(), { allowDevScenario: false });
    const flaggedOff = await json<{
      scan: { recognition: { provider: string; detections: Array<{ name: string | null }> } };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(flaggedOff.status).toBe(201);
    expect(flaggedOff.body.scan.recognition.provider).toBe("off");
    expect(flaggedOff.body.scan.recognition.detections[0]?.name).toBeNull();
    expect(JSON.stringify(flaggedOff.body)).not.toContain("Pikachu");

    const live = createApp(createMemoryStore(), {
      allowDevScenario: false,
      liveIdentifyEnabled: true,
    });
    const missingImage = await json<{
      scan: { recognition: { detections: Array<{ name?: string | null }> } };
    }>(live, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(missingImage.status).toBe(201);
    expect(JSON.stringify(missingImage.body)).not.toContain("Pikachu");
    expect(missingImage.body.scan.recognition.detections).toEqual([]);
  });

  it("does not confirm a mock catalog card when the live catalog is down", async () => {
    const catalog = {
      ...mockTcgdexCatalogProvider,
      name: "tcgdex" as const,
      async getCardById(): Promise<null> {
        throw new CatalogProviderError({
          code: "PROVIDER_UNAVAILABLE",
          message: "down",
          retryable: true,
        });
      },
    };
    const app = createApp(createMemoryStore(), { catalog });
    const scan = await json<{ scan: { scanId: string } }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "no-match" }),
    });
    expect(scan.status).toBe(201);
    const confirmed = await json<{ error?: string }>(
      app,
      `/v1/scans/${scan.body.scan.scanId}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ tcgdexId: "base1-58" }),
      },
    );
    expect(confirmed.status).toBe(503);
    expect(confirmed.body.error).toBe("Catalog unavailable, try again.");
  });
});
