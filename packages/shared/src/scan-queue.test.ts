import { describe, expect, it } from "vitest";
import {
  SCAN_QUEUE_MAX_ITEMS,
  dueScans,
  emptyScanQueue,
  enqueueScan,
  expiredScans,
  markScanFailed,
  markScanReady,
  parseScanQueue,
  readyToConfirm,
  scanQueueLabel,
} from "./scan-queue";

const add = (s: ReturnType<typeof emptyScanQueue>, id: string, now = 0) =>
  enqueueScan(s, { id, fileUri: `file:///doc/scan-queue/${id}.jpg`, mimeType: "image/jpeg", captureMethod: "camera_photo" }, now);

describe("P1-10 offline scan queue", () => {
  it("20 offline scans all become ready, none duplicated", () => {
    let s = emptyScanQueue();
    for (let i = 0; i < 20; i += 1) s = add(s, `k${i}`);
    s = add(s, "k3"); // same key again
    expect(s.items).toHaveLength(20);
    for (const item of dueScans(s)) s = markScanReady(s, item.id, `scan-${item.id}`);
    expect(readyToConfirm(s)).toHaveLength(20);
    expect(s.items.every((i) => i.fileUri === null)).toBe(true);
    expect(scanQueueLabel(s)).toBe("20 ready to confirm");
  });
  it("backs off failures and caps the queue", () => {
    let s = add(emptyScanQueue(), "a", 1000);
    s = markScanFailed(s, "a", 1000);
    expect(dueScans(s, 1000)).toHaveLength(0);
    expect(dueScans(s, 1000 + 3000)).toHaveLength(1);
    let full = emptyScanQueue();
    for (let i = 0; i < SCAN_QUEUE_MAX_ITEMS + 5; i += 1) full = add(full, `f${i}`);
    expect(full.items).toHaveLength(SCAN_QUEUE_MAX_ITEMS);
    expect(scanQueueLabel(s)).toBe("1 scan waiting for connection");
  });
  it("expires after 30 days and survives bad JSON", () => {
    const s = add(emptyScanQueue(), "old", 0);
    expect(expiredScans(s, 31 * 86_400_000).map((i) => i.id)).toEqual(["old"]);
    expect(expiredScans(s, 29 * 86_400_000)).toEqual([]);
    expect(parseScanQueue("{nope")).toEqual(emptyScanQueue());
    expect(parseScanQueue(JSON.stringify(s)).items).toHaveLength(1);
  });
});
