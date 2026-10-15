import { describe, expect, it } from "vitest";
import {
  dueWrites,
  emptyWriteQueue,
  enqueueWrite,
  markWriteFailed,
  parseWriteQueue,
  removeWrite,
  shouldRetryWrite,
  writeQueueLabel,
  writeRetryDelayMs,
  WRITE_QUEUE_MAX_DELAY_MS,
} from "./write-queue";

describe("offline write queue (P1-09)", () => {
  it("dedupes by idempotency key and replays oldest first", () => {
    let q = enqueueWrite(emptyWriteQueue(), { id: "a", kind: "livestream_purchase", payload: { t: 1 } }, 1);
    q = enqueueWrite(q, { id: "a", kind: "livestream_purchase", payload: { t: 2 } }, 2);
    q = enqueueWrite(q, { id: "b", kind: "save_watchlist", payload: {} }, 3);
    expect(q.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(dueWrites(q, 10).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("backs off after failures and survives a JSON round-trip (app kill)", () => {
    let q = enqueueWrite(emptyWriteQueue(), { id: "a", kind: "livestream_purchase", payload: {} }, 0);
    q = markWriteFailed(q, "a", "offline", 1000);
    expect(dueWrites(q, 1000)).toEqual([]);
    expect(dueWrites(q, 1000 + writeRetryDelayMs(1))).toHaveLength(1);
    expect(writeRetryDelayMs(30)).toBe(WRITE_QUEUE_MAX_DELAY_MS);
    const restored = parseWriteQueue(JSON.stringify(q));
    expect(restored.items[0]).toMatchObject({ id: "a", attempts: 1, lastError: "offline" });
    expect(removeWrite(restored, "a").items).toEqual([]);
    expect(parseWriteQueue("nope").items).toEqual([]);
  });

  it("retries network and transient errors only", () => {
    expect(shouldRetryWrite(undefined)).toBe(true);
    expect(shouldRetryWrite(503)).toBe(true);
    expect(shouldRetryWrite(429)).toBe(true);
    expect(shouldRetryWrite(409)).toBe(false);
    expect(shouldRetryWrite(400)).toBe(false);
  });

  it("labels the sync indicator", () => {
    expect(writeQueueLabel(0)).toBeNull();
    expect(writeQueueLabel(3)).toBe("3 waiting to sync");
  });
});
