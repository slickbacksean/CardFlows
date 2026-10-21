/**
 * Sean (Oct 21): Live Scan identifies cards automatically with CardSight on the backend.
 *
 * - No "identify" button, no "is it one of these?" prompt. Nothing (no name, no price) is shown
 *   until CardSight says Medium or High. Low / missing confidence = stay quiet and retry on the
 *   next new stable card.
 * - Cost control: the phone only sends a frame when a new card is held steady (existing tracker +
 *   unchanged-frame skip). The server de-dupes the same card (crop hash) per user, rate-limits each
 *   scanner session, and enforces a per-user daily cap and an app-wide daily cap. Every call also
 *   counts toward the one global monthly CardSight budget inside the adapter.
 * - Before sending, the Whatnot chat and bid overlay regions are blacked out, plus everything in the
 *   crop outside the card's corners (where chat text leaks into the margin).
 * - Multi-card or non-English results never become a guess: nothing, or a quiet
 *   "try one card at a time" hint.
 */
import jpeg from "jpeg-js";
import type {
  CardFlowNormalizedRecognitionResult,
  RecognitionDetection,
} from "@cardflow/shared";

export interface LiveCardSightLimits {
  /** CardSight calls per user per UTC day from Live Scan. */
  perUserDaily: number;
  /** CardSight calls per UTC day from Live Scan, all users together (one global meter). */
  globalDaily: number;
  /** CardSight calls per scanner session per rolling minute. */
  perSessionPerMinute: number;
  /** How long a card already sent (same crop hash) is answered from memory instead of re-sent. */
  dedupeMs: number;
}

/**
 * Defaults (override with env):
 * - CARD_FLOW_LIVE_CARDSIGHT_USER_DAILY=150 (~1.5–2 h of active Live Scan per user per day)
 * - CARD_FLOW_LIVE_CARDSIGHT_GLOBAL_DAILY=1500 (fits a ~45k/month plan; alerts at 50/75/90%)
 * - CARD_FLOW_LIVE_CARDSIGHT_SESSION_PER_MIN=6 (one new card every ~10 s is a fast Whatnot pace)
 * - CARD_FLOW_LIVE_CARDSIGHT_DEDUPE_SECONDS=180
 */
export const LIVE_CARDSIGHT_DEFAULTS: LiveCardSightLimits = {
  perUserDaily: 150,
  globalDaily: 1500,
  perSessionPerMinute: 6,
  dedupeMs: 180_000,
};

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function liveCardSightLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): LiveCardSightLimits {
  return {
    perUserDaily: positiveInt(env.CARD_FLOW_LIVE_CARDSIGHT_USER_DAILY, LIVE_CARDSIGHT_DEFAULTS.perUserDaily),
    globalDaily: positiveInt(env.CARD_FLOW_LIVE_CARDSIGHT_GLOBAL_DAILY, LIVE_CARDSIGHT_DEFAULTS.globalDaily),
    perSessionPerMinute: positiveInt(
      env.CARD_FLOW_LIVE_CARDSIGHT_SESSION_PER_MIN,
      LIVE_CARDSIGHT_DEFAULTS.perSessionPerMinute,
    ),
    dedupeMs:
      positiveInt(env.CARD_FLOW_LIVE_CARDSIGHT_DEDUPE_SECONDS, LIVE_CARDSIGHT_DEFAULTS.dedupeMs / 1000) * 1000,
  };
}

/** Live Scan uses CardSight unless CARD_FLOW_LIVESTREAM_CARDSIGHT is 0/false/off/no. */
export function liveCardSightEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CARD_FLOW_LIVESTREAM_CARDSIGHT?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

export const LIVE_CARDSIGHT_GLOBAL_METER = "cardsight_live";
export const liveCardSightUserMeter = (userId: string) => `cardsight_live_user:${userId}`;
export const utcDayKey = (now: Date) => now.toISOString().slice(0, 10);

/** Alert levels for the app-wide daily meter. */
export const LIVE_CARDSIGHT_ALERT_LEVELS = [90, 75, 50] as const;
export function liveCardSightAlertLevel(used: number, cap: number): 0 | 50 | 75 | 90 {
  if (!(cap > 0)) return 0;
  const pct = (used / cap) * 100;
  for (const level of LIVE_CARDSIGHT_ALERT_LEVELS) if (pct >= level) return level;
  return 0;
}

export const LIVE_ONE_CARD_HINT = "one_card_at_a_time" as const;

export type LiveCardSightVerdict =
  | { kind: "identified"; detection: RecognitionDetection; index: number }
  | { kind: "low" }
  | { kind: "multi_card" }
  | { kind: "non_english" }
  | { kind: "none" };

function isEnglish(language: string | null): boolean {
  if (language == null || language.trim() === "") return true; // CardSight omits it for English
  const l = language.trim().toLowerCase();
  return l === "en" || l === "eng" || l === "english" || l.startsWith("en-") || l.startsWith("en_");
}

/** Never a guess: only one English card at Medium or High confidence is shown. */
export function liveCardSightVerdict(result: CardFlowNormalizedRecognitionResult): LiveCardSightVerdict {
  if (!result.ok || result.detections.length === 0) return { kind: "none" };
  if (result.detections.length > 1) return { kind: "multi_card" };
  const detection = result.detections[0]!;
  if (!isEnglish(detection.language)) return { kind: "non_english" };
  if (detection.confidence === "High" || detection.confidence === "Medium") {
    return { kind: "identified", detection, index: 0 };
  }
  return { kind: "low" };
}

/** Same card in view: crop hashes within this Hamming distance (105-bit RGB pHash). */
export const LIVE_SAME_CARD_HASH_DISTANCE = 12;

export function sameCardHash(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length !== b.length || a.length === 0) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && ++d > LIVE_SAME_CARD_HASH_DISTANCE) return false;
  }
  return true;
}

export interface LiveCardSightCached {
  at: number;
  tcgdexId: string | null;
  confidence: "High" | "Medium" | null;
  hint: typeof LIVE_ONE_CARD_HINT | null;
}

/** In-memory per-user de-dupe and per-session rate limit. No photos are kept, only hashes. */
export function createLiveCardSightGate(limits: LiveCardSightLimits, nowMs: () => number = Date.now) {
  const seen = new Map<string, Array<{ key: string } & LiveCardSightCached>>();
  const sessions = new Map<string, number[]>();
  let lastSweep = 0;

  function sweep(t: number) {
    if (t - lastSweep < 60_000) return;
    lastSweep = t;
    for (const [user, rows] of seen) {
      const keep = rows.filter((r) => t - r.at < limits.dedupeMs);
      if (keep.length) seen.set(user, keep);
      else seen.delete(user);
    }
    for (const [s, times] of sessions) {
      const keep = times.filter((x) => t - x < 60_000);
      if (keep.length) sessions.set(s, keep);
      else sessions.delete(s);
    }
  }

  return {
    /** A recent CardSight answer for this same card, if any. */
    recall(userId: string, key: string | null): LiveCardSightCached | null {
      if (!key) return null;
      const t = nowMs();
      sweep(t);
      const rows = seen.get(userId) ?? [];
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!;
        if (t - row.at >= limits.dedupeMs) continue;
        const same = key.startsWith("hash:") && row.key.startsWith("hash:")
          ? sameCardHash(key.slice(5), row.key.slice(5))
          : key === row.key;
        if (same) return row;
      }
      return null;
    },
    remember(userId: string, key: string | null, value: Omit<LiveCardSightCached, "at">) {
      if (!key) return;
      const rows = seen.get(userId) ?? [];
      rows.push({ key, at: nowMs(), ...value });
      seen.set(userId, rows.slice(-50));
    },
    /** Takes a session slot when there is room. */
    takeSessionSlot(sessionKey: string): boolean {
      if (limits.perSessionPerMinute <= 0) return false;
      const t = nowMs();
      const recent = (sessions.get(sessionKey) ?? []).filter((x) => t - x < 60_000);
      if (recent.length >= limits.perSessionPerMinute) {
        sessions.set(sessionKey, recent);
        return false;
      }
      recent.push(t);
      sessions.set(sessionKey, recent);
      return true;
    },
  };
}

export type LiveCardSightGate = ReturnType<typeof createLiveCardSightGate>;

export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Whatnot live-show overlays in a portrait frame (normalized, top-left origin):
 * the chat feed (lower-left), the bid / buy-now bar (bottom), and the right-side action rail.
 * Override with CARD_FLOW_LIVE_MASK_REGIONS (JSON array of {x,y,width,height}).
 */
export const WHATNOT_OVERLAY_REGIONS: readonly NormRect[] = [
  { x: 0, y: 0.55, width: 0.72, height: 0.33 }, // chat
  { x: 0, y: 0.86, width: 1, height: 0.14 }, // bid / buy bar
  { x: 0.84, y: 0.42, width: 0.16, height: 0.44 }, // right action rail
  { x: 0, y: 0, width: 1, height: 0.08 }, // host name / viewer count bar
];

export function liveMaskRegionsFromEnv(env: NodeJS.ProcessEnv = process.env): readonly NormRect[] {
  const raw = env.CARD_FLOW_LIVE_MASK_REGIONS?.trim();
  if (!raw) return WHATNOT_OVERLAY_REGIONS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return WHATNOT_OVERLAY_REGIONS;
    const rects = parsed.filter(
      (r): r is NormRect =>
        !!r && typeof r === "object" &&
        ["x", "y", "width", "height"].every((k) => typeof (r as Record<string, unknown>)[k] === "number"),
    );
    return rects.length ? rects : WHATNOT_OVERLAY_REGIONS;
  } catch {
    return WHATNOT_OVERLAY_REGIONS;
  }
}

function insideQuad(px: number, py: number, quad: readonly number[]): boolean {
  // Convex quad TL,TR,BR,BL; inside when all edge cross products share a sign.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const ax = quad[i * 2]!, ay = quad[i * 2 + 1]!;
    const bx = quad[((i + 1) % 4) * 2]!, by = quad[((i + 1) % 4) * 2 + 1]!;
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Black out Whatnot overlay regions (in frame space, using where the crop sits in the frame) and,
 * when the card corners are known, everything in the crop outside the card.
 * Returns a fresh JPEG, or null when the crop cannot be decoded (then nothing is sent).
 */
export function maskLiveCrop(
  bytes: Uint8Array,
  opts: {
    /** 8 numbers, card corners in crop pixels. */
    quad?: readonly number[] | null;
    /** Where the crop sits in the full frame, normalized. */
    cropInFrame?: NormRect | null;
    regions?: readonly NormRect[];
  } = {},
): Uint8Array | null {
  let image: { width: number; height: number; data: Uint8Array };
  try {
    image = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 64 }) as never;
  } catch {
    return null;
  }
  const { width, height, data } = image;
  if (!width || !height) return null;
  const quad = opts.quad && opts.quad.length === 8 && opts.quad.every(Number.isFinite) ? opts.quad : null;
  const frame = opts.cropInFrame;
  const regions = frame ? (opts.regions ?? WHATNOT_OVERLAY_REGIONS) : [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let black = quad ? !insideQuad(x + 0.5, y + 0.5, quad) : false;
      if (!black && frame) {
        const fx = frame.x + ((x + 0.5) / width) * frame.width;
        const fy = frame.y + ((y + 0.5) / height) * frame.height;
        black = regions.some((r) => fx >= r.x && fx < r.x + r.width && fy >= r.y && fy < r.y + r.height);
      }
      if (black) {
        const i = (y * width + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
    }
  }
  return new Uint8Array(jpeg.encode({ width, height, data }, 85).data);
}
