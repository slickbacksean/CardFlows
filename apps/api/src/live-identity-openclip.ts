/**
 * HTTP client for the OpenCLIP livestream identity sidecar.
 * Pipeline inspired by t-sinclair2500/pokemon-scanner (MIT). Never PokéCollector Gemini.
 */

export interface LiveIdentityOpenclipMatch {
  tcgdexId: string | null;
  similarity: number | null;
  accepted: boolean;
  pipeline: "openclip_hnsw";
}

export interface LiveIdentityOpenclipOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function joinUrl(baseUrl: string, pathName: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = pathName.startsWith("/") ? pathName : `/${pathName}`;
  return `${base}${path}`;
}

export function createLiveIdentityOpenclipClient(options: LiveIdentityOpenclipOptions) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 4000;
  const token = options.token?.trim() ?? "";
  const baseUrl = options.baseUrl.trim();

  return {
    name: "openclip_hnsw" as const,
    async matchCropJpeg(
      bytes: Uint8Array,
      mimeType = "image/jpeg",
      options?: { name?: string },
    ): Promise<LiveIdentityOpenclipMatch | null> {
      if (!baseUrl || bytes.byteLength < 32 || bytes.byteLength > 8_000_000) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const form = new FormData();
        form.append(
          "crop",
          new Blob([Buffer.from(bytes)], { type: mimeType }),
          mimeType === "image/png" ? "crop.png" : "crop.jpg",
        );
        const name = options?.name?.trim();
        if (name) form.append("name", name);
        const headers: Record<string, string> = {};
        if (token) headers["X-CardFlow-Token"] = token;
        const response = await fetchImpl(joinUrl(baseUrl, "/v1/match"), {
          method: "POST",
          headers,
          body: form,
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const body = (await response.json()) as {
          accepted?: unknown;
          tcgdexId?: unknown;
          similarity?: unknown;
          pipeline?: unknown;
        };
        const tcgdexId =
          typeof body.tcgdexId === "string" && body.tcgdexId.trim() ? body.tcgdexId.trim() : null;
        return {
          pipeline: "openclip_hnsw",
          accepted: body.accepted === true && Boolean(tcgdexId),
          tcgdexId: body.accepted === true ? tcgdexId : null,
          similarity: typeof body.similarity === "number" ? body.similarity : null,
        };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type LiveIdentityOpenclipClient = ReturnType<typeof createLiveIdentityOpenclipClient>;

export function resolveLiveIdentityOpenclipFromEnv(env: NodeJS.ProcessEnv = process.env): {
  client: LiveIdentityOpenclipClient | null;
  reason: string;
} {
  const baseUrl = env.CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL?.trim() ?? "";
  if (!baseUrl) {
    return { client: null, reason: "CARD_FLOW_LIVE_IDENTITY_OPENCLIP_URL empty" };
  }
  const timeoutRaw = env.CARD_FLOW_LIVE_IDENTITY_OPENCLIP_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 4000;
  return {
    client: createLiveIdentityOpenclipClient({
      baseUrl,
      token: env.CARD_FLOW_LIVE_IDENTITY_OPENCLIP_TOKEN,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 4000,
    }),
    reason: "openclip sidecar",
  };
}

/** Decode data-URL or raw base64 JPEG/PNG crop from the live-video native module. */
export function decodeIdentityCropJpeg(raw: string | null | undefined): {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
} | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const trimmed = raw.trim();
  const dataUrl = /^data:(image\/(?:jpeg|jpg|png));base64,(.+)$/i.exec(trimmed);
  const mimeRaw = dataUrl?.[1]?.toLowerCase() ?? "image/jpeg";
  const mimeType = mimeRaw === "image/png" ? "image/png" : "image/jpeg";
  const b64 = dataUrl?.[2] ?? trimmed;
  try {
    const binary = Buffer.from(b64, "base64");
    if (binary.byteLength < 32 || binary.byteLength > 8_000_000) return null;
    return { bytes: new Uint8Array(binary), mimeType };
  } catch {
    return null;
  }
}
