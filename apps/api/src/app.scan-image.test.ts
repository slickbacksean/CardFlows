import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import {
  SCAN_IMAGE_MAX_BYTES,
  isFirstPartyScanImageRef,
  mimeFromFileName,
  mimeFromScanStorageRef,
  normalizeScanImageMime,
  scanImageStorageRef,
} from "./scan-image";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TINY_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

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

function jpegFile(name = "still.jpg", bytes: Uint8Array = TINY_JPEG) {
  return new File([bytes], name, { type: "image/jpeg" });
}

async function postScanWithImage(
  app: App,
  file: File,
  fields: { captureMethod?: string; scenario?: string } = {},
) {
  const form = new FormData();
  form.append("captureMethod", fields.captureMethod ?? "camera_photo");
  form.append("scenario", fields.scenario ?? "high-confidence");
  form.append("image", file);
  return app.request("/v1/scans", { method: "POST", body: form });
}

describe("scan image helpers", () => {
  it("normalizes mime and builds a first-party object key", () => {
    expect(normalizeScanImageMime("image/jpg")).toBe("image/jpeg");
    expect(normalizeScanImageMime("image/png; charset=binary")).toBe("image/png");
    expect(normalizeScanImageMime("image/gif")).toBeNull();
    expect(mimeFromFileName("still.WEBP")).toBe("image/webp");
    const ref = scanImageStorageRef("11111111-1111-1111-1111-111111111111", "image/jpeg");
    expect(ref).toBe("scans/11111111-1111-1111-1111-111111111111.jpg");
    expect(isFirstPartyScanImageRef(ref)).toBe(true);
    expect(mimeFromScanStorageRef(ref)).toBe("image/jpeg");
    expect(isFirstPartyScanImageRef("https://api.cardsight.ai/v1/identify/card")).toBe(false);
    expect(isFirstPartyScanImageRef("https://assets.tcgdex.net/en/base/base1/58/high.webp")).toBe(
      false,
    );
  });
});

describe("first-party scan stills", () => {
  const tempDirs: string[] = [];
  const stores: SqliteStorePort[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps JSON-only POST when no file is sent and does not invent an image", async () => {
    const app = createApp(createMemoryStore());
    const created = await json<{
      scan: {
        scanId: string;
        imageStorageRef: string | null;
        imageMimeType: string | null;
        cardflowCardId: string | null;
        inventoryItemId: string | null;
      };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(created.status).toBe(201);
    expect(created.body.scan.cardflowCardId).toBeNull();
    expect(created.body.scan.inventoryItemId).toBeNull();
    expect(created.body.scan.imageStorageRef).toBeNull();
    expect(created.body.scan.imageMimeType).toBeNull();

    const missing = await app.request(`/v1/scans/${created.body.scan.scanId}/image`);
    expect(missing.status).toBe(404);
  });

  it("stores multipart jpeg bytes and serves them from GET /v1/scans/:id/image", async () => {
    const app = createApp(createMemoryStore());
    const response = await postScanWithImage(app, jpegFile());
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      scan: {
        scanId: string;
        imageStorageRef: string;
        imageMimeType: string;
        recognition: unknown;
      };
    };
    expect(body.scan.imageMimeType).toBe("image/jpeg");
    expect(body.scan.imageStorageRef).toBe(`scans/${body.scan.scanId}.jpg`);
    expect(isFirstPartyScanImageRef(body.scan.imageStorageRef)).toBe(true);
    expect(body.scan.imageStorageRef).not.toMatch(/^https?:/i);
    expect(JSON.stringify(body.scan.recognition)).not.toContain("cardsight.ai");

    const image = await app.request(`/v1/scans/${body.scan.scanId}/image`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(TINY_JPEG);
  });

  it("rejects gif and oversize stills without calling a vendor", async () => {
    const app = createApp(createMemoryStore());
    const gif = await postScanWithImage(
      app,
      new File([TINY_JPEG], "still.gif", { type: "image/gif" }),
    );
    expect(gif.status).toBe(400);
    expect(await gif.json()).toMatchObject({ error: "Image must be jpeg, png, or webp" });

    const oversize = await postScanWithImage(
      app,
      new File([new Uint8Array(SCAN_IMAGE_MAX_BYTES + 1)], "still.jpg", { type: "image/jpeg" }),
    );
    expect(oversize.status).toBe(413);
    expect(await oversize.json()).toMatchObject({ error: "Image must be 20 MB or smaller" });
  });

  it("rejects extra JSON and multipart fields before identify", async () => {
    const app = createApp(createMemoryStore());
    const extraJson = await json<{ error: string }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({
        captureMethod: "camera_photo",
        scenario: "high-confidence",
        apiKey: "secret",
      }),
    });
    expect(extraJson.status).toBe(400);
    expect(extraJson.body).toMatchObject({ error: "Unexpected field" });

    const form = new FormData();
    form.append("captureMethod", "camera_photo");
    form.append("scenario", "high-confidence");
    form.append("image", jpegFile());
    form.append("X-API-Key", "secret");
    const extraForm = await app.request("/v1/scans", { method: "POST", body: form });
    expect(extraForm.status).toBe(400);
    expect(await extraForm.json()).toMatchObject({ error: "Unexpected field" });
  });

  it("survives SQLite reopen and is never used as Collection catalog art", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-scan-image-"));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const first = createSqliteStore({ sqlitePath });
    stores.push(first);
    const firstApp = createApp(first);

    const created = await postScanWithImage(firstApp, jpegFile(), {
      captureMethod: "manual_scan",
    });
    expect(created.status).toBe(201);
    const scan = (await created.json()) as {
      scan: { scanId: string; imageStorageRef: string; imageMimeType: string };
    };

    const confirmed = await json<{
      confirmation: { confirmationId: string };
      canonicalCard: { image: { constructedUrl: string; source: string } };
    }>(firstApp, `/v1/scans/${scan.scan.scanId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.canonicalCard.image.source).toBe("tcgdex_assets");
    expect(confirmed.body.canonicalCard.image.constructedUrl).toContain("assets.tcgdex.net");
    expect(confirmed.body.canonicalCard.image.constructedUrl).not.toContain("/v1/scans/");

    const purchased = await json<{ item: { inventoryItemId: string } }>(
      firstApp,
      "/v1/inventory/purchased",
      {
        method: "POST",
        body: JSON.stringify({
          confirmationId: confirmed.body.confirmation.confirmationId,
          purchasePrice: "10.50",
          purchasedAt: "2026-09-16",
        }),
      },
    );
    expect(purchased.status).toBe(201);

    stores.pop()?.close();
    const second = createSqliteStore({ sqlitePath });
    stores.push(second);
    const app = createApp(second);

    const image = await app.request(`/v1/scans/${scan.scan.scanId}/image`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(TINY_JPEG);

    const inventory = await json<{
      items: Array<{ card: { imageUrl: string | null; tcgdexId: string } | null }>;
    }>(app, "/v1/inventory");
    expect(inventory.body.items[0]?.card?.tcgdexId).toBe("base1-58");
    expect(inventory.body.items[0]?.card?.imageUrl).toContain("assets.tcgdex.net");
    expect(inventory.body.items[0]?.card?.imageUrl).not.toContain("/v1/scans/");
  });

  it("does not forward stills to CardSight and Confirm never treats the still as catalog art", () => {
    const appSrc = readFileSync(path.join(repoRoot, "apps/api/src/app.ts"), "utf8");
    const capture = readFileSync(path.join(repoRoot, "apps/mobile/app/capture.tsx"), "utf8");
    const confirm = readFileSync(
      path.join(repoRoot, "apps/mobile/app/scan/[scanId].tsx"),
      "utf8",
    );

    expect(appSrc).toContain("identifyLiveCaptureStill");
    expect(readFileSync(path.join(repoRoot, "apps/api/src/scan-card-name.ts"), "utf8")).toContain(
      "fallback.identifyCard",
    );
    expect(appSrc).toContain("readStoredScanImage");
    expect(appSrc).toContain("decideScanIdentify");
    expect(appSrc).toContain("skippedStillIdentifyResult");
    expect(appSrc).not.toContain("identifyCardMock");
    expect(appSrc).not.toContain("cardsightIdentifySkippedResult");
    expect(appSrc).toContain('app.get("/v1/scans/:scanId/image"');
    expect(appSrc).not.toContain("cardsight.ai");
    expect(appSrc).not.toContain("X-API-Key");

    expect(capture).toContain("imageUri");
    expect(capture).not.toContain("cardsight.ai");
    expect(confirm).toContain("Your picture");
    expect(confirm).toContain("getConfirmPictureUri");
    expect(confirm).toContain("card.image.constructedUrl");
    expect(confirm).not.toContain("result.canonicalCard.image");
  });
});
