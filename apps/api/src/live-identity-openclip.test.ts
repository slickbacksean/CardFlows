import { describe, expect, it, vi } from "vitest";
import {
  createLiveIdentityOpenclipClient,
  decodeIdentityCropJpeg,
  resolveLiveIdentityOpenclipFromEnv,
} from "./live-identity-openclip";

describe("live identity OpenCLIP client", () => {
  it("decodes raw and data-URL crops", () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, ...Array(40).fill(1)]);
    const b64 = Buffer.from(bytes).toString("base64");
    expect(decodeIdentityCropJpeg(b64)?.mimeType).toBe("image/jpeg");
    expect(decodeIdentityCropJpeg(`data:image/png;base64,${b64}`)?.mimeType).toBe("image/png");
    expect(decodeIdentityCropJpeg("")).toBeNull();
  });

  it("resolves off when URL empty", () => {
    expect(resolveLiveIdentityOpenclipFromEnv({}).client).toBeNull();
  });

  it("posts crop and returns accepted tcgdex id", async () => {
    const fetchImpl = vi.fn(
      async (..._args: Parameters<typeof fetch>) =>
        new Response(
          JSON.stringify({
            ok: true,
            accepted: true,
            tcgdexId: "base1-58",
            similarity: 0.91,
            pipeline: "openclip_hnsw",
          }),
          { status: 200 },
        ),
    );
    const client = createLiveIdentityOpenclipClient({
      baseUrl: "http://127.0.0.1:8092",
      token: "secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, ...Array(40).fill(2)]);
    const match = await client.matchCropJpeg(bytes);
    expect(match).toEqual({
      pipeline: "openclip_hnsw",
      accepted: true,
      tcgdexId: "base1-58",
      similarity: 0.91,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-CardFlow-Token")).toBe("secret");
  });

  it("sends a printed name so the sidecar can rank that Pokémon's prints", async () => {
    const fetchImpl = vi.fn(
      async (..._args: Parameters<typeof fetch>) =>
        new Response(
          JSON.stringify({
            ok: true,
            accepted: true,
            tcgdexId: "me05-009",
            similarity: 0.81,
            pipeline: "openclip_hnsw",
          }),
          { status: 200 },
        ),
    );
    const client = createLiveIdentityOpenclipClient({
      baseUrl: "http://127.0.0.1:8092",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, ...Array(40).fill(4)]);
    const match = await client.matchCropJpeg(bytes, "image/jpeg", { name: "Sizzlipede" });
    expect(match?.tcgdexId).toBe("me05-009");
    const body = fetchImpl.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("name")).toBe("Sizzlipede");
  });

  it("fails soft on network errors", async () => {
    const client = createLiveIdentityOpenclipClient({
      baseUrl: "http://127.0.0.1:8092",
      fetchImpl: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    expect(await client.matchCropJpeg(Uint8Array.from(Array(40).fill(3)))).toBeNull();
  });
});
