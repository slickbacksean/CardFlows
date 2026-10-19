import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  CARDMAGIC_PROCESS_PATH,
  CARDMAGIC_TIMEOUT_MS,
  cardMagicFromEnv,
  createCardMagicClient,
  parseCardMagicBody,
} from "./cardmagic-adapter";
import { unzipCardMagicArchive } from "./cardmagic-zip";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0x01, 0x02]);
const JPEG2 = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0x03, 0x04]);

function zipStore(files: Record<string, Uint8Array>): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14); // crc
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    parts.push(local, Buffer.from(data));
    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(0, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    nameBuf.copy(cen, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...parts, centralBuf, end]));
}

describe("CardMagic ZIP helper", () => {
  it("reads STORE and DEFLATE entries by basename", () => {
    const stored = zipStore({ "card_0.jpg": JPEG, "nested/card_0_top-left.jpg": JPEG2 });
    const entries = unzipCardMagicArchive(stored);
    expect(entries.map((e) => e.name).sort()).toEqual(["card_0.jpg", "card_0_top-left.jpg"]);

    const name = Buffer.from("card_1.jpg");
    const raw = Buffer.from(JPEG);
    const compressed = deflateRawSync(raw);
    const local = Buffer.alloc(30 + name.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    compressed.copy(local, 30 + name.length);
    const inflated = unzipCardMagicArchive(new Uint8Array(local));
    expect(inflated[0]?.name).toBe("card_1.jpg");
    expect(Buffer.from(inflated[0]!.data)).toEqual(raw);
  });
});

describe("parseCardMagicBody", () => {
  it("accepts a single JPEG or a corners ZIP", () => {
    expect(parseCardMagicBody(JPEG, "image/jpeg")[0]?.cardJpeg).toEqual(JPEG);
    const archive = zipStore({
      "card_0.jpg": JPEG,
      "card_0_top-left.jpg": JPEG2,
      "card_0_top-right.jpg": JPEG2,
      "card_0_bottom-right.jpg": JPEG2,
      "card_0_bottom-left.jpg": JPEG2,
      "card_0_corners.jpg": JPEG2,
    });
    const cards = parseCardMagicBody(archive, "application/zip");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.cardJpeg).toEqual(JPEG);
    expect(cards[0]!.corners.topLeft).toEqual(JPEG2);
    expect(cards[0]!.corners.sheet).toEqual(JPEG2);
  });
});

describe("CardMagic client", () => {
  const noSleep = async () => {};

  it("is off unless CARD_FLOW_CARDMAGIC=on with a key", () => {
    expect(cardMagicFromEnv({})).toBeNull();
    expect(cardMagicFromEnv({ CARDSIGHT_API_KEY: "k" })).toBeNull();
    expect(cardMagicFromEnv({ CARD_FLOW_CARDMAGIC: "on" })).toBeNull();
    expect(cardMagicFromEnv({ CARD_FLOW_CARDMAGIC: "on", CARDSIGHT_API_KEY: "k" })).not.toBeNull();
  });

  it("posts multipart with mode=process, autoLevels=false, corners=true", async () => {
    const archive = zipStore({ "card_0.jpg": JPEG, "card_0_top-left.jpg": JPEG2 });
    const fetchMock = vi.fn(async () =>
      new Response(archive, {
        status: 200,
        headers: { "content-type": "application/zip", "X-CardMagic-Count": "1" },
      }),
    );
    const client = createCardMagicClient({ apiKey: "secret", fetch: fetchMock as never });
    const result = await client.process({ bytes: JPEG, mimeType: "image/jpeg" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cards[0]!.cardJpeg).toEqual(JPEG);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(CARDMAGIC_PROCESS_PATH);
    expect(url).toContain("mode=process");
    expect(url).toContain("autoLevels=false");
    expect(url).toContain("corners=true");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("secret");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("maps 422 NO_CARD_FOUND and timeouts without throwing", async () => {
    const noCard = vi.fn(async () =>
      new Response(JSON.stringify({ code: "NO_CARD_FOUND" }), { status: 422 }),
    );
    const miss = await createCardMagicClient({ apiKey: "k", fetch: noCard as never }).process({
      bytes: JPEG,
      mimeType: "image/jpeg",
    });
    expect(miss).toMatchObject({ ok: false, reason: "no_card", httpStatus: 422 });

    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))),
        ),
    );
    const timed = await createCardMagicClient({
      apiKey: "k",
      fetch: hang as never,
      timeoutMs: 5,
    }).process({ bytes: JPEG, mimeType: "image/jpeg" });
    expect(timed).toMatchObject({ ok: false, reason: "timeout" });
    expect(CARDMAGIC_TIMEOUT_MS).toBe(8_000);
  });
});
