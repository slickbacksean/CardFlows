import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mapRecognitionToCatalog } from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { startDiskUsageMonitor } from "./disk-usage";
import { deleteGradeExtrasSession, gradeExtrasDir, gradeExtrasSessionPath, saveGradeExtraShot } from "./grade-extra-store";
import { OpsMetrics, type OpsAlert } from "./ops-metrics";
import {
  GRADED_PHOTO_RETENTION_HOURS,
  SCAN_PHOTO_TTL_HOURS,
  isScanPhotoExpired,
  scanPhotoTtlHoursFromEnv,
} from "./photo-retention";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import { createMemoryStore, type ScanRecord } from "./store";

const TINY_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);

async function makeScan(userId: string, capturedAt: string): Promise<ScanRecord> {
  const recognition = identifyCardMock("high-confidence");
  return {
    scanId: crypto.randomUUID(),
    userId,
    capturedAt,
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

describe("Sean (Oct 19): photos are not stored", () => {
  const stores: SqliteStorePort[] = [];
  const dirs: string[] = [];
  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("sweeps leftovers after 24 h; TTL is configurable", () => {
    expect(SCAN_PHOTO_TTL_HOURS).toBe(24);
    expect(GRADED_PHOTO_RETENTION_HOURS).toBe(24);
    expect(scanPhotoTtlHoursFromEnv({})).toBe(24);
    expect(scanPhotoTtlHoursFromEnv({ CARD_FLOW_SCAN_PHOTO_TTL_HOURS: "6" })).toBe(6);
    expect(scanPhotoTtlHoursFromEnv({ CARD_FLOW_SCAN_PHOTO_TTL_HOURS: "x" })).toBe(24);
    const now = new Date("2026-01-02T00:00:00.000Z");
    expect(isScanPhotoExpired("2026-01-01T00:00:00.000Z", now, 24)).toBe(true);
    expect(isScanPhotoExpired("2026-01-01T00:00:01.000Z", now, 24)).toBe(false);
  });

  it("sqlite sweep deletes the file only; the scan row stays", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-nostore-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "cardflow.sqlite") });
    stores.push(store);
    const old = await makeScan("u1", "2026-01-01T00:00:00.000Z");
    const fresh = await makeScan("u1", "2026-01-01T23:00:00.000Z");
    for (const scan of [old, fresh]) {
      const img = store.saveScanImage(scan.scanId, { bytes: TINY_JPEG, mimeType: "image/jpeg" });
      store.saveScan({ ...scan, imageStorageRef: img.storageRef, imageMimeType: img.mimeType });
    }
    const ref = store.getScan("u1", old.scanId)!.imageStorageRef!;
    expect(store.purgeExpiredScanPhotos(new Date("2026-01-02T00:00:00.000Z"), 24).deleted).toBe(1);
    expect(existsSync(path.join(dir, ref))).toBe(false);
    expect(store.getScan("u1", old.scanId)?.mapping).toEqual(old.mapping);
    expect(store.getScan("u1", old.scanId)?.imageStorageRef).toBeNull();
    expect(store.getScan("u1", fresh.scanId)?.imageStorageRef).not.toBeNull();
  });

  it("memory sweep follows the same rule", async () => {
    const store = createMemoryStore();
    const old = await makeScan("u2", "2026-01-01T00:00:00.000Z");
    const img = store.saveScanImage(old.scanId, { bytes: TINY_JPEG, mimeType: "image/jpeg" });
    store.saveScan({ ...old, imageStorageRef: img.storageRef, imageMimeType: img.mimeType });
    expect(store.purgeExpiredScanPhotos(new Date("2026-01-03T00:00:00.000Z"), 24).deleted).toBe(1);
    expect(store.getScan("u2", old.scanId)?.imageStorageRef).toBeNull();
  });

  it("grade extras live under <dataDir>/grade/extras and a session is deleted after the result", () => {
    expect(gradeExtrasDir({ CARD_FLOW_SQLITE_PATH: "/data/cardflow.sqlite" })).toBe("/data/grade/extras");
    const ok = saveGradeExtraShot({
      userId: "u3",
      sessionId: "gs_nostore_0001",
      side: "front",
      shot: "tilt",
      still: { bytes: TINY_JPEG, mimeType: "image/jpeg" },
    });
    expect(ok).toBe(true);
    expect(gradeExtrasSessionPath("u3", "gs_nostore_0001")).not.toBeNull();
    expect(deleteGradeExtrasSession("u3", "gs_nostore_0001")).toBe(1);
    expect(gradeExtrasSessionPath("u3", "gs_nostore_0001")).toBeNull();
  });
});

describe("low-disk alert", () => {
  it("alerts once at 70% and once at 85%, re-arming after it drops", () => {
    const alerts: OpsAlert[] = [];
    let t = 0;
    const metrics = new OpsMetrics([(a) => alerts.push(a)], () => (t += 3_600_000));
    let used = 50;
    const monitor = startDiskUsageMonitor({ dir: "/data", metrics, read: () => ({ usedBytes: used, totalBytes: 100 }) });
    used = 72;
    monitor.runOnce();
    monitor.runOnce();
    used = 90;
    monitor.runOnce();
    monitor.runOnce();
    used = 40;
    monitor.runOnce();
    used = 75;
    monitor.runOnce();
    monitor.stop();
    expect(alerts.map((a) => a.kind)).toEqual(["volume_disk_70", "volume_disk_85", "volume_disk_70"]);
  });
});
