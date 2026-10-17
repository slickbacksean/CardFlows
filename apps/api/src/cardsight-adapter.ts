/**
 * P1-05: CardSight still-identify adapter (server only). OFF by default and not wired
 * into `createRecognitionFromEnv` until Sean picks a tier and supplies a staging key (D3).
 *
 * - 3 s timeout per attempt; up to 2 retries with backoff on 408/5xx (and network errors).
 * - No retry on 401/400/404/other 4xx. 429 maps to RATE_LIMITED (no retry; fall back).
 * - Monthly budget gate before each call (QUOTA_EXCEEDED → fallback + alert).
 * - Wire mapping is tolerant and based on the integration doc; recorded responses in
 *   `fixtures/cardsight-wire-*.json` are synthetic until a staging key exists.
 */
import type {
  CardFlowNormalizedRecognitionResult,
  CardRecognitionProvider,
  IdentifyCardRequest,
  RecognitionCandidate,
  RecognitionConfidence,
  RecognitionDetection,
  RecognitionError,
} from "@cardflow/shared";

export const CARDSIGHT_BASE_URL = "https://api.cardsight.ai";
export const CARDSIGHT_TIMEOUT_MS = 3_000;
export const CARDSIGHT_MAX_RETRIES = 2;

export interface CardSightAdapterOptions {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Returns false when the monthly budget is used up. */
  consumeBudget?: () => boolean;
  /** Ops alert hook (quota exhausted, auth failure). Never receives the key or image. */
  onAlert?: (event: { code: string; httpStatus?: number }) => void;
  sleep?: (ms: number) => Promise<void>;
}

const CODE_BY_STATUS: Record<number, RecognitionError["code"]> = {
  400: "BAD_REQUEST",
  401: "PROVIDER_AUTH",
  403: "PROVIDER_AUTH",
  404: "NOT_FOUND",
  408: "PROVIDER_TIMEOUT",
  429: "RATE_LIMITED",
};

export function cardSightErrorFor(status: number | null): RecognitionError {
  if (status === null) {
    return { code: "PROVIDER_TIMEOUT", message: "Card matching timed out.", retryable: true };
  }
  const code = CODE_BY_STATUS[status] ?? (status >= 500 ? "PROVIDER_UNAVAILABLE" : "UNKNOWN");
  return {
    code,
    httpStatus: status,
    message: "Card matching is unavailable right now. Search by name or number.",
    retryable: status === 408 || status === 429 || status >= 500,
  };
}

export function isRetryableStatus(status: number | null): boolean {
  return status === null || status === 408 || status >= 500;
}

function confidence(value: unknown): RecognitionConfidence {
  const text = String(value ?? "").toLowerCase();
  if (text === "high") return "High";
  if (text === "medium") return "Medium";
  return "Low";
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
}

type Wire = Record<string, unknown>;

function cardFields(card: Wire) {
  const set = (card.set ?? {}) as Wire;
  return {
    vendorCardId: str(card.id) ?? str(card.cardId),
    name: str(card.name),
    setName: str(card.setName) ?? str(set.name),
    number: str(card.number) ?? str(card.cardNumber),
    language: str(card.language),
  };
}

export const CARDSIGHT_BAD_RESPONSE: RecognitionError = {
  code: "PROVIDER_UNAVAILABLE",
  message: "Card matching is unavailable right now. Search by name or number.",
  retryable: true,
};

/**
 * Wire → normalized mapping. Backend review: a body that is not a JSON object, that says
 * `success: false`, or whose `detections` is present but not an array is an error (so the
 * fallback matcher runs), not an empty ok result.
 */
export function mapCardSightWire(body: unknown, elapsedMs: number | null): CardFlowNormalizedRecognitionResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure(CARDSIGHT_BAD_RESPONSE);
  const root = body as Wire;
  if (root.success === false || (root.detections !== undefined && !Array.isArray(root.detections))) {
    return failure(CARDSIGHT_BAD_RESPONSE);
  }
  const rawDetections = Array.isArray(root.detections) ? (root.detections as Wire[]) : [];
  const detections: RecognitionDetection[] = rawDetections.map((det) => {
    const card = ((det.card ?? det) as Wire) ?? {};
    const suggestions = Array.isArray(det.suggestions) ? (det.suggestions as Wire[]) : [];
    const candidates: RecognitionCandidate[] = suggestions.map((s, rank) => ({
      ...cardFields((s.card ?? s) as Wire),
      fields: [],
      rank,
    }));
    return {
      confidence: confidence(det.confidence),
      // Backend review: a missing matchLevel is unknown (null), never "exact".
      matchLevel: str(det.matchLevel),
      ...cardFields(card),
      fields: [],
      candidates,
    };
  });
  return {
    provider: "cardsight",
    ok: true,
    vendorRequestId: str(root.requestId) ?? str(root.id),
    processingTimeMs: typeof root.processingTime === "number" ? root.processingTime : elapsedMs,
    detections,
    error: null,
  };
}

function failure(error: RecognitionError): CardFlowNormalizedRecognitionResult {
  return { provider: "cardsight", ok: false, vendorRequestId: null, processingTimeMs: null, detections: [], error };
}

export function createCardSightRecognitionProvider(options: CardSightAdapterOptions): CardRecognitionProvider {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? CARDSIGHT_BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? CARDSIGHT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? CARDSIGHT_MAX_RETRIES;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return {
    name: "cardsight",
    async identifyCard(req: IdentifyCardRequest) {
      if (options.consumeBudget && !options.consumeBudget()) {
        options.onAlert?.({ code: "QUOTA_EXCEEDED" });
        return failure({ code: "QUOTA_EXCEEDED", message: "Card matching is unavailable right now. Search by name or number.", retryable: false });
      }
      const path = req.segment ? `/v1/identify/card/${encodeURIComponent(req.segment)}` : "/v1/identify/card";
      let lastStatus: number | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        if (attempt > 0) await sleep(250 * 2 ** (attempt - 1));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const started = Date.now();
        try {
          const form = new FormData();
          form.append("image", new Blob([req.image], { type: req.mimeType }), "card");
          const res = await doFetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: { "X-API-Key": options.apiKey },
            body: form,
            signal: controller.signal,
          });
          if (res.ok) return mapCardSightWire(await res.json().catch(() => null), Date.now() - started);
          lastStatus = res.status;
          if (res.status === 401 || res.status === 403) options.onAlert?.({ code: "PROVIDER_AUTH", httpStatus: res.status });
          if (!isRetryableStatus(res.status)) break;
        } catch {
          lastStatus = null;
        } finally {
          clearTimeout(timer);
        }
      }
      return failure(cardSightErrorFor(lastStatus));
    },
  };
}

/**
 * Primary (CardSight) → fallback (on-device/self-hosted matcher). When both miss, the
 * phone shows manual search (P1-06) because the result carries no detections.
 */
export function createRecognitionWithFallback(
  primary: CardRecognitionProvider,
  fallback: CardRecognitionProvider,
  onFallback?: (reason: string) => void,
): CardRecognitionProvider {
  return {
    name: primary.name,
    async identifyCard(req) {
      const first = await primary.identifyCard(req);
      if (first.ok) return first;
      onFallback?.(first.error?.code ?? "UNKNOWN");
      return fallback.identifyCard(req);
    },
  };
}

/** Adapter only when explicitly enabled AND a key is present. Not wired yet (D3). */
export function cardSightAdapterFromEnv(
  env: NodeJS.Dict<string | undefined>,
  extra: Omit<CardSightAdapterOptions, "apiKey"> = {},
): CardRecognitionProvider | null {
  if (env.CARD_FLOW_CARDSIGHT_ADAPTER?.trim().toLowerCase() !== "on") return null;
  const apiKey = env.CARDSIGHT_API_KEY?.trim();
  if (!apiKey) return null;
  return createCardSightRecognitionProvider({ apiKey, ...extra });
}
