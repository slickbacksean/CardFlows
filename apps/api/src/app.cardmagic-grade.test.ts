import { describe, expect, it, vi } from "vitest";
import {
  AGE_GATE_VERSION,
  CARDSIGHT_CONSENT_VERSION,
  DEFAULT_INVITED_USER_ID,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createCardMagicClient } from "./cardmagic-adapter";
import { createMemoryStore } from "./store";
import type { CardgradingRunner } from "./cardgrading-run";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0xaa]);
const CROP = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0xbb, 0xcc]);

function zipOneCard(card: Uint8Array, corner: Uint8Array): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "card_0.jpg": card,
    "card_0_top-left.jpg": corner,
    "card_0_top-right.jpg": corner,
    "card_0_bottom-right.jpg": corner,
    "card_0_bottom-left.jpg": corner,
  };
  const parts: Buffer[] = [];
  let offset = 0;
  const central: Buffer[] = [];
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    parts.push(local, Buffer.from(data));
    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    nameBuf.copy(cen, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, centralBuf, end]));
}

function localRunner(calls: unknown[]): CardgradingRunner {
  return {
    async detectCrop(input: { photoBytes: Uint8Array; photoExt: string }) {
      calls.push(input);
      return {
        report: {
          gates: [{ name: "card_detection", passed: true }],
          image_size: [100, 140],
          detect_method: "edge",
        },
        cropBytes: Buffer.from(JPEG),
      };
    },
    async gradeCard() {
      throw new Error("not used");
    },
  } as never;
}

async function grantConsent(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/consents/cardsight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ granted: true, version: CARDSIGHT_CONSENT_VERSION }),
  });
  expect(res.status).toBe(200);
}

async function detect(app: ReturnType<typeof createApp>, sessionId?: string) {
  const form = new FormData();
  form.append("photo", new File([JPEG], "front.jpg", { type: "image/jpeg" }));
  form.append("side", "front");
  if (sessionId) form.append("sessionId", sessionId);
  const res = await app.request("/v1/grade/detect", { method: "POST", body: form });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("CardMagic on grade detect (hybrid)", () => {
  it("uses CardMagic crop when enabled + consented, and stages that crop", async () => {
    const store = createMemoryStore();
    store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-18T00:00:00.000Z");
    const localCalls: unknown[] = [];
    const fetchMock = vi.fn(async () =>
      new Response(zipOneCard(CROP, JPEG), {
        status: 200,
        headers: { "content-type": "application/zip", "X-CardMagic-Count": "1" },
      }),
    );
    const app = createApp(store, {
      cardMagic: createCardMagicClient({ apiKey: "k", fetch: fetchMock as never }),
      cardgrading: localRunner(localCalls),
      gradeQuota: false,
    });
    await grantConsent(app);
    const { status, body } = await detect(app);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "found", cropPath: "cardmagic" });
    expect(typeof body.uploadId).toBe("string");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localCalls).toHaveLength(0);
    const url = (fetchMock.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain("autoLevels=false");
    expect(url).toContain("corners=true");
  });

  it("falls back to local detect without consent, when disabled, or on NO_CARD_FOUND", async () => {
    const store = createMemoryStore();
    store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-18T00:00:00.000Z");
    const localCalls: unknown[] = [];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "NO_CARD_FOUND" }), { status: 422 }));
    const app = createApp(store, {
      cardMagic: createCardMagicClient({ apiKey: "k", fetch: fetchMock as never }),
      cardgrading: localRunner(localCalls),
      gradeQuota: false,
    });
    // No consent → local, no CardMagic call
    let res = await detect(app);
    expect(res.body.cropPath).toBe("local");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localCalls).toHaveLength(1);

    await grantConsent(app);
    res = await detect(app);
    expect(res.body.cropPath).toBe("local");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localCalls).toHaveLength(2);

    const off = createApp(store, { cardMagic: null, cardgrading: localRunner(localCalls), gradeQuota: false });
    res = await detect(off);
    expect(res.body.cropPath).toBe("local");
  });

  it("never calls CardMagic for guests", async () => {
    const store = createMemoryStore();
    const fetchMock = vi.fn();
    const app = createApp(store, {
      guestMode: true,
      cardMagic: createCardMagicClient({ apiKey: "k", fetch: fetchMock as never }),
      cardgrading: localRunner([]),
      gradeQuota: false,
      devAutoSession: false,
    });
    const guest = await app.request("/v1/sessions/guest", { method: "POST" });
    expect(guest.status).toBe(200);
    const token = ((await guest.json()) as { token: string }).token;
    const form = new FormData();
    form.append("photo", new File([JPEG], "front.jpg", { type: "image/jpeg" }));
    const res = await app.request("/v1/grade/detect", {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${token}` },
    });
    // Guests are blocked from grade routes (signup_required); never CardMagic.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });
});

describe("CardMagic ID reserve + global budget", () => {
  it("skips CardMagic when total CardSight usage has hit the ID reserve floor", async () => {
    const store = createMemoryStore();
    store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-18T00:00:00.000Z");
    // Cap 10, reserve 8 → CardMagic only while used < 2
    store.consumeVendorQuota("cardsight", "2026-10", 10);
    store.consumeVendorQuota("cardsight", "2026-10", 10);
    expect(store.getVendorQuotaUsage("cardsight", "2026-10")).toBe(2);

    const localCalls: unknown[] = [];
    const fetchMock = vi.fn(async () =>
      new Response(zipOneCard(CROP, JPEG), {
        status: 200,
        headers: { "content-type": "application/zip", "X-CardMagic-Count": "1" },
      }),
    );
    const app = createApp(store, {
      cardMagic: createCardMagicClient({ apiKey: "k", fetch: fetchMock as never }),
      cardgrading: localRunner(localCalls),
      gradeQuota: false,
      cardSightMonthlyBudget: 10,
      cardMagicIdReserve: 8,
      now: () => new Date("2026-10-18T12:00:00.000Z"),
    });
    await grantConsent(app);
    const { status, body } = await detect(app);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "found", cropPath: "local" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localCalls).toHaveLength(1);
    // Reserve skip must not burn more of the shared budget.
    expect(store.getVendorQuotaUsage("cardsight", "2026-10")).toBe(2);
  });

  it("runs CardMagic and consumes the shared budget while under the reserve floor", async () => {
    const store = createMemoryStore();
    store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-18T00:00:00.000Z");
    const localCalls: unknown[] = [];
    const fetchMock = vi.fn(async () =>
      new Response(zipOneCard(CROP, JPEG), {
        status: 200,
        headers: { "content-type": "application/zip", "X-CardMagic-Count": "1" },
      }),
    );
    const app = createApp(store, {
      cardMagic: createCardMagicClient({ apiKey: "k", fetch: fetchMock as never }),
      cardgrading: localRunner(localCalls),
      gradeQuota: false,
      cardSightMonthlyBudget: 10,
      cardMagicIdReserve: 8,
      now: () => new Date("2026-10-18T12:00:00.000Z"),
    });
    await grantConsent(app);
    const { status, body } = await detect(app);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, cropPath: "cardmagic" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localCalls).toHaveLength(0);
    expect(store.getVendorQuotaUsage("cardsight", "2026-10")).toBe(1);
  });
});
