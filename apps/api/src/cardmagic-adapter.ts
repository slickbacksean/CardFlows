/**
 * CardMagic (CardSight) for saved grading photos. OFF unless CARD_FLOW_CARDMAGIC=on
 * and CARDSIGHT_API_KEY is set. Callers must also check consent, age, and guest rules
 * (same plumbing as CardSight identify). Falls back to CardFlow's own card finder.
 *
 * Docs: https://cardsight.ai/solutions/cardmagic
 */
import { CARDSIGHT_BASE_URL } from "./cardsight-adapter";
import { unzipCardMagicArchive } from "./cardmagic-zip";

export const CARDMAGIC_TIMEOUT_MS = 8_000;
export const CARDMAGIC_PROCESS_PATH = "/v1/cardmagic/process";

export type CardMagicFailReason =
  | "disabled"
  | "no_card"
  | "timeout"
  | "http"
  | "error"
  | "empty";

export interface CardMagicCornerSet {
  topLeft?: Uint8Array;
  topRight?: Uint8Array;
  bottomRight?: Uint8Array;
  bottomLeft?: Uint8Array;
  sheet?: Uint8Array;
}

export interface CardMagicCard {
  /** Straightened 5:7 card JPEG (card_0). */
  cardJpeg: Uint8Array;
  corners: CardMagicCornerSet;
}

export type CardMagicResult =
  | { ok: true; cards: CardMagicCard[]; elapsedMs: number; count: number }
  | { ok: false; reason: CardMagicFailReason; httpStatus?: number; message?: string; elapsedMs: number };

export interface CardMagicAdapterOptions {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Defaults: mode=process, autoLevels=false, corners=true, outputFormat=jpeg. */
  mode?: "process" | "crop";
  autoLevels?: boolean;
  corners?: boolean;
}

export interface CardMagicProcessInput {
  bytes: Uint8Array;
  mimeType: string;
  fileName?: string;
}

function fail(reason: CardMagicFailReason, started: number, extra?: { httpStatus?: number; message?: string }): CardMagicResult {
  return { ok: false, reason, elapsedMs: Date.now() - started, ...extra };
}

function queryString(options: CardMagicAdapterOptions): string {
  const params = new URLSearchParams({
    mode: options.mode ?? "process",
    autoLevels: options.autoLevels === true ? "true" : "false",
    corners: options.corners === false ? "false" : "true",
    outputFormat: "jpeg",
  });
  return params.toString();
}

function cornerKey(name: string): keyof CardMagicCornerSet | null {
  const base = name.toLowerCase();
  if (base.includes("top-left") || base.includes("top_left")) return "topLeft";
  if (base.includes("top-right") || base.includes("top_right")) return "topRight";
  if (base.includes("bottom-right") || base.includes("bottom_right")) return "bottomRight";
  if (base.includes("bottom-left") || base.includes("bottom_left")) return "bottomLeft";
  if (base.includes("corners") && !base.includes("top") && !base.includes("bottom")) return "sheet";
  return null;
}

/** Parse a CardMagic binary body (single JPEG or ZIP of card_N + corners). */
export function parseCardMagicBody(bytes: Uint8Array, contentType: string | null): CardMagicCard[] {
  const type = (contentType ?? "").toLowerCase();
  const looksZip =
    type.includes("application/zip") ||
    type.includes("application/x-zip") ||
    (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (!looksZip) {
    if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return [];
    return [{ cardJpeg: bytes, corners: {} }];
  }
  const entries = unzipCardMagicArchive(bytes);
  const byIndex = new Map<number, CardMagicCard>();
  for (const entry of entries) {
    const cardMatch = /^card_(\d+)\.(jpe?g|png)$/i.exec(entry.name);
    if (cardMatch) {
      const index = Number(cardMatch[1]);
      const row = byIndex.get(index) ?? { cardJpeg: new Uint8Array(), corners: {} };
      row.cardJpeg = entry.data;
      byIndex.set(index, row);
      continue;
    }
    const indexMatch = /^card_(\d+)/i.exec(entry.name);
    const index = indexMatch ? Number(indexMatch[1]) : 0;
    const key = cornerKey(entry.name);
    if (!key) continue;
    const row = byIndex.get(index) ?? { cardJpeg: new Uint8Array(), corners: {} };
    row.corners[key] = entry.data;
    byIndex.set(index, row);
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, card]) => card)
    .filter((card) => card.cardJpeg.byteLength > 0);
}

export function createCardMagicClient(options: CardMagicAdapterOptions) {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? CARDSIGHT_BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? CARDMAGIC_TIMEOUT_MS;

  return {
    async process(input: CardMagicProcessInput): Promise<CardMagicResult> {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const form = new FormData();
        const mime = input.mimeType || "image/jpeg";
        form.append("image", new Blob([input.bytes], { type: mime }), input.fileName ?? "card.jpg");
        const res = await doFetch(`${baseUrl}${CARDMAGIC_PROCESS_PATH}?${queryString(options)}`, {
          method: "POST",
          headers: { "X-API-Key": options.apiKey },
          body: form,
          signal: controller.signal,
        });
        if (res.status === 422) {
          let code: string | undefined;
          try {
            const body = (await res.json()) as { code?: string; error?: { code?: string } };
            code = body.code ?? body.error?.code;
          } catch {
            /* ignore */
          }
          return fail("no_card", started, {
            httpStatus: 422,
            message: code === "NO_CARD_FOUND" ? "NO_CARD_FOUND" : "no card",
          });
        }
        if (!res.ok) {
          return fail("http", started, { httpStatus: res.status, message: `HTTP ${res.status}` });
        }
        const buffer = new Uint8Array(await res.arrayBuffer());
        const cards = parseCardMagicBody(buffer, res.headers.get("content-type"));
        if (cards.length === 0) return fail("empty", started, { message: "empty CardMagic body" });
        const countHeader = res.headers.get("X-CardMagic-Count");
        const count = countHeader ? Number(countHeader) : cards.length;
        return {
          ok: true,
          cards,
          count: Number.isFinite(count) ? count : cards.length,
          elapsedMs: Date.now() - started,
        };
      } catch (error) {
        const aborted =
          (error instanceof Error && error.name === "AbortError") ||
          (typeof error === "object" && error !== null && "name" in error && (error as { name: string }).name === "AbortError");
        if (aborted) return fail("timeout", started, { message: "CardMagic timed out" });
        return fail("error", started, {
          message: error instanceof Error ? error.message.slice(0, 200) : "CardMagic error",
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type CardMagicClient = ReturnType<typeof createCardMagicClient>;

/** Adapter only when CARD_FLOW_CARDMAGIC=on AND a CardSight key is present. */
export function cardMagicFromEnv(
  env: NodeJS.Dict<string | undefined>,
  extra: Omit<CardMagicAdapterOptions, "apiKey"> = {},
): CardMagicClient | null {
  if (env.CARD_FLOW_CARDMAGIC?.trim().toLowerCase() !== "on") return null;
  const apiKey = env.CARDSIGHT_API_KEY?.trim();
  if (!apiKey) return null;
  return createCardMagicClient({ apiKey, ...extra });
}

export function cardMagicEnabledFromEnv(env: NodeJS.Dict<string | undefined> = process.env): boolean {
  return cardMagicFromEnv(env) !== null;
}
