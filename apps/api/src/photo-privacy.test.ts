import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_INVITED_USER_ID,
  GRADE_STILL_QUALITY,
  INVITED_USERS,
  mapRecognitionToCatalog,
} from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import type { CardgradingRunner } from "./cardgrading-run";
import { createGradeUploadCache, imageCarriesExif, imageCarriesGps } from "./grade-image";
import {
  GRADED_PHOTO_RETENTION_HOURS,
  isGradePhotoExpired,
  startPhotoRetentionJob,
} from "./photo-retention";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import type { ScanRecord } from "./store";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function jpegWithGpsExif(): Uint8Array {
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x88, 0x25, 0x00, 0x04, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = payload.length + 2;
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x20, 0x00, 0x20, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

async function makeScan(userId: string): Promise<ScanRecord> {
  const recognition = identifyCardMock("high-confidence");
  return {
    scanId: crypto.randomUUID(),
    userId,
    capturedAt: new Date().toISOString(),
    captureMethod: "camera_photo",
    scenario: "high-confidence",
    preInventoryState: "scan_captured",
    cardflowCardId: null,
    confirmationId: null,
    inventoryItemId: null,
    imageStorageRef: null,
    imageMimeType: null,
    recognition,
    mapping: await mapRecognitionToCatalog(recognition),
  };
}

describe("P0-07 photo privacy", () => {
  const stores: SqliteStorePort[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function openStore() {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-privacy-"));
    tempDirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "cardflow.sqlite") });
    stores.push(store);
    return { dir, store };
  }

  async function purchasedItem(store: SqliteStorePort, userId: string) {
    const { confirmation, canonicalCard } = store.confirmScan({
      scan: store.saveScan(await makeScan(userId)),
      selectedTcgdexId: "base1-58",
    });
    return store.saveInventoryItem({
      inventoryItemId: crypto.randomUUID(),
      userId,
      cardflowCardId: canonicalCard.cardflowCardId as string,
      confirmationId: confirmation.confirmationId,
      scanId: confirmation.scanId,
      intent: "purchased",
      grain: "physical_copy",
      selectedVariant: null,
      condition: null,
      quantity: 1,
      tags: ["raw"],
      workflowState: "acquired",
      referencePriceAmount: null,
      targetMaxBuyAmount: null,
      createdAt: new Date().toISOString(),
      purchase: null,
    });
  }

  it("stores no EXIF or GPS on a saved grade still or scan still", async () => {
    const { dir, store } = openStore();
    const userId = DEFAULT_INVITED_USER_ID;
    const item = await purchasedItem(store, userId);
    const dirty = jpegWithGpsExif();
    expect(imageCarriesGps(dirty)).toBe(true);

    const saved = store.saveGradeImage(userId, item.inventoryItemId, "front", {
      bytes: dirty,
      mimeType: "image/jpeg",
    });
    expect(saved).toBeDefined();
    const stored = store.getGradeImage(userId, item.inventoryItemId, "front");
    expect(stored?.bytes).toBeDefined();
    expect(imageCarriesExif(stored!.bytes)).toBe(false);
    expect(imageCarriesGps(stored!.bytes)).toBe(false);
    expect(imageCarriesExif(new Uint8Array(readFileSync(path.join(dir, saved!.storageRef))))).toBe(
      false,
    );

    const scan = store.saveScan(await makeScan(userId));
    store.saveScanImage(scan.scanId, { bytes: dirty, mimeType: "image/jpeg" });
    store.saveScan({
      ...scan,
      imageStorageRef: `scans/${scan.scanId}.jpg`,
      imageMimeType: "image/jpeg",
    });
    const scanStill = store.getScanImage(userId, scan.scanId);
    expect(scanStill).toBeDefined();
    expect(imageCarriesExif(scanStill!.bytes)).toBe(false);
    expect(imageCarriesGps(scanStill!.bytes)).toBe(false);
  });

  it("deletes raw detect uploads once pregrade finishes", async () => {
    const cache = createGradeUploadCache();
    const runner: CardgradingRunner = {
      async gradeCard() {
        return {
          grade_estimate: { overall_grade: 8 },
          subgrades: {},
          capture_quality: { front: { gates: [] }, back: { gates: [] } },
        };
      },
      async detectCrop() {
        return { report: { gates: [] }, cropBytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
      },
    };
    const app = createApp(undefined, { cardgrading: runner, gradeUploads: cache });
    const dirty = jpegWithGpsExif();
    const frontForm = new FormData();
    frontForm.append("image", new File([dirty], "front.jpg", { type: "image/jpeg" }));
    frontForm.append("side", "front");
    const frontRes = await app.request("/v1/grade/detect", { method: "POST", body: frontForm });
    const front = (await frontRes.json()) as { ok?: boolean; uploadId?: string };
    const backForm = new FormData();
    backForm.append("image", new File([dirty], "back.jpg", { type: "image/jpeg" }));
    backForm.append("side", "back");
    const backRes = await app.request("/v1/grade/detect", { method: "POST", body: backForm });
    const back = (await backRes.json()) as { ok?: boolean; uploadId?: string };
    expect(front.uploadId && back.uploadId).toBeTruthy();
    expect(cache.get(DEFAULT_INVITED_USER_ID, front.uploadId ?? "", "front")).toBeDefined();
    expect(imageCarriesExif(cache.get(DEFAULT_INVITED_USER_ID, front.uploadId ?? "", "front")!.bytes)).toBe(
      false,
    );

    const grade = new FormData();
    grade.append("frontUploadId", front.uploadId ?? "");
    grade.append("backUploadId", back.uploadId ?? "");
    await app.request("/v1/grade/pregrade", { method: "POST", body: grade });
    expect(cache.get(DEFAULT_INVITED_USER_ID, front.uploadId ?? "", "front")).toBeUndefined();
    expect(cache.get(DEFAULT_INVITED_USER_ID, back.uploadId ?? "", "back")).toBeUndefined();
  });

  it("deletes graded photos at day 30 on a fake clock", async () => {
    const { store } = openStore();
    const userId = DEFAULT_INVITED_USER_ID;
    const item = await purchasedItem(store, userId);
    const createdAt = "2026-01-01T00:00:00.000Z";
    store.saveGradeImage(userId, item.inventoryItemId, "front", {
      bytes: jpegWithGpsExif(),
      mimeType: "image/jpeg",
      createdAt,
    });
    store.saveGradeImage(userId, item.inventoryItemId, "back", {
      bytes: jpegWithGpsExif(),
      mimeType: "image/jpeg",
      createdAt,
    });
    expect(GRADED_PHOTO_RETENTION_HOURS).toBe(24);
    expect(isGradePhotoExpired(createdAt, new Date("2026-01-01T23:59:59.000Z"))).toBe(false);
    expect(store.purgeExpiredGradePhotos(new Date("2026-01-01T23:59:59.000Z")).deleted).toBe(0);
    expect(store.getGradeImage(userId, item.inventoryItemId, "front")).toBeDefined();

    const day30 = new Date("2026-01-02T00:00:00.000Z");
    expect(isGradePhotoExpired(createdAt, day30)).toBe(true);
    expect(store.purgeExpiredGradePhotos(day30).deleted).toBe(2);
    expect(store.getGradeImage(userId, item.inventoryItemId, "front")).toBeUndefined();
    expect(store.getGradeImage(userId, item.inventoryItemId, "back")).toBeUndefined();
  });

  it("runs the daily job against a fake clock", () => {
    let now = new Date("2026-01-31T00:00:00.000Z");
    const calls: Date[] = [];
    const job = startPhotoRetentionJob({
      now: () => now,
      intervalMs: 60_000,
      purge: (when) => {
        calls.push(when);
        return { deleted: 0 };
      },
    });
    expect(calls).toEqual([new Date("2026-01-31T00:00:00.000Z")]);
    now = new Date("2026-03-02T00:00:00.000Z");
    expect(job.runOnce().deleted).toBe(0);
    expect(calls[1]).toEqual(now);
    job.stop();
  });

  it("deletes every photo the same day on account deletion", async () => {
    const { store } = openStore();
    const alex = INVITED_USERS[0].userId;
    const jordan = INVITED_USERS[1].userId;
    const alexItem = await purchasedItem(store, alex);
    const jordanItem = await purchasedItem(store, jordan);
    store.saveGradeImage(alex, alexItem.inventoryItemId, "front", {
      bytes: jpegWithGpsExif(),
      mimeType: "image/jpeg",
    });
    store.saveGradeImage(jordan, jordanItem.inventoryItemId, "front", {
      bytes: jpegWithGpsExif(),
      mimeType: "image/jpeg",
    });
    const scan = store.saveScan(await makeScan(alex));
    const savedScan = store.saveScanImage(scan.scanId, {
      bytes: jpegWithGpsExif(),
      mimeType: "image/jpeg",
    });
    store.saveScan({
      ...scan,
      imageStorageRef: savedScan.storageRef,
      imageMimeType: savedScan.mimeType,
    });

    const app = createApp(store);
    const deleted = await app.request("/v1/account/delete", { method: "POST" });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ ok: true, photosDeleted: expect.any(Number) });
    expect(store.getGradeImage(alex, alexItem.inventoryItemId, "front")).toBeUndefined();
    expect(store.getScanImage(alex, scan.scanId)).toBeUndefined();
    expect(store.getGradeImage(jordan, jordanItem.inventoryItemId, "front")).toBeDefined();
  });

  it("keeps Expo Go phone-side prep: manipulator re-encode, no native EXIF module", () => {
    const gradePhotos = readFileSync(path.join(repoRoot, "apps/mobile/lib/grade-photos.ts"), "utf8");
    expect(gradePhotos).toContain('from "expo-image-manipulator"');
    expect(gradePhotos).toContain("SaveFormat.JPEG");
    expect(gradePhotos).toContain("GRADE_STILL_QUALITY");
    expect(GRADE_STILL_QUALITY).toBe(0.8);
    expect(gradePhotos).toMatch(/strips EXIF|EXIF\/GPS are dropped/);
    expect(gradePhotos).not.toMatch(/piexif|exif-parser|expo-media-library|requireNativeModule/);
    expect(gradePhotos).not.toMatch(/from ["']capacitor/i);
  });
});
