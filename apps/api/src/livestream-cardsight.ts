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
  /** Live Scan's ceiling on the one global monthly CardSight meter (shared with Scan a Card). */
  globalMonthly: number;
  /** CardSight calls per user per rolling minute (server-side key, not a client session id). */
  perSessionPerMinute: number;
  /** How long a card already sent (same crop hash) is answered from memory instead of re-sent. */
  dedupeMs: number;
  /** Live Scan CardSight calls per Premium user per calendar month; past it, in-house only. */
  premiumMonthly: number;
  /** Same for users on the free Live Scan trial. */
  trialMonthly: number;
  /** CardSight deadline for one Live Scan frame (ms). Past it the frame shows nothing. */
  deadlineMs: number;
  /** Computer Vision (Oct 21): in-house alone for this long after the card appears, then CardSight. */
  handoffMs: number;
  /** Nothing confident by this card age = show nothing and stop trying. */
  giveUpMs: number;
}

/**
 * Hybrid (Sean, Oct 21): the in-house matcher answers alone when it is this confident AND the same
 * top-1 won 2 of the last 3 frames of the card. Computer Vision (Oct 21): 0.86 / 0.02 (the matcher's
 * own accept gate); not tuned on Whatnot frames.
 * Env: CARD_FLOW_LIVE_INHOUSE_MIN_SIMILARITY / CARD_FLOW_LIVE_INHOUSE_MIN_MARGIN.
 */
export interface LiveInHouseGate {
  minSimilarity: number;
  minMargin: number;
}
export const LIVE_INHOUSE_GATE_DEFAULTS: LiveInHouseGate = { minSimilarity: 0.86, minMargin: 0.02 };
/** Same top-1 on this many of the last LIVE_INHOUSE_VOTE_WINDOW frames of the card. */
export const LIVE_INHOUSE_VOTES = 2;
export const LIVE_INHOUSE_VOTE_WINDOW = 3;

export function liveInHouseGateFromEnv(env: NodeJS.ProcessEnv = process.env): LiveInHouseGate {
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw?.trim());
    return raw != null && raw.trim() !== "" && Number.isFinite(n) ? n : fallback;
  };
  return {
    minSimilarity: num(env.CARD_FLOW_LIVE_INHOUSE_MIN_SIMILARITY, LIVE_INHOUSE_GATE_DEFAULTS.minSimilarity),
    minMargin: num(env.CARD_FLOW_LIVE_INHOUSE_MIN_MARGIN, LIVE_INHOUSE_GATE_DEFAULTS.minMargin),
  };
}

/** True when the in-house top match is confident enough to show without CardSight. */
export function inHouseConfident(
  input: { tcgdexId: string | null; candidates: readonly { tcgdexId: string; similarity: number }[] },
  gate: LiveInHouseGate,
): boolean {
  const top = input.candidates[0];
  if (!input.tcgdexId || !top || top.tcgdexId !== input.tcgdexId) return false;
  const second = input.candidates[1]?.similarity ?? 0;
  return top.similarity >= gate.minSimilarity && top.similarity - second >= gate.minMargin;
}

/**
 * Computer Vision (Oct 21): every Live Scan cap comes from ONE plan setting,
 * CARD_FLOW_CARDSIGHT_PLAN_MONTHLY (falls back to CARD_FLOW_CARDSIGHT_MONTHLY_BUDGET, then 750 = the
 * current free plan). Scan a Card keeps a 25% reserve of the plan; Live Scan may use the rest of the
 * shared monthly meter. Raising the plan (e.g. Ultra 100k) scales everything.
 *
 * At 750/month: Live Scan monthly 562, app-wide daily 19, per user daily 3, Premium monthly 56,
 * trial monthly 11, 6/min per user.
 * At 100,000/month: Live Scan monthly 75,000, daily 2,500, per user daily 150, Premium 1,000, trial 200.
 */
export const CARDSIGHT_PLAN_DEFAULT = 750;
export const LIVE_SCAN_RESERVE_FOR_SCAN = 0.25;

export function liveCardSightLimitsForPlan(planMonthly: number): Omit<LiveCardSightLimits, "deadlineMs" | "handoffMs" | "giveUpMs" | "dedupeMs" | "perSessionPerMinute"> {
  const plan = Math.max(0, Math.floor(planMonthly));
  const globalMonthly = Math.floor(plan * (1 - LIVE_SCAN_RESERVE_FOR_SCAN));
  const globalDaily = Math.max(1, Math.ceil(globalMonthly / 30));
  const premiumMonthly = Math.min(1_000, Math.max(1, Math.floor(globalMonthly / 10)));
  return {
    globalMonthly,
    globalDaily,
    perUserDaily: Math.min(150, Math.max(1, Math.floor(globalDaily / 5))),
    premiumMonthly,
    trialMonthly: Math.min(200, Math.max(1, Math.floor(premiumMonthly / 5))),
  };
}

export function cardSightPlanFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CARD_FLOW_CARDSIGHT_PLAN_MONTHLY ?? env.CARD_FLOW_CARDSIGHT_MONTHLY_BUDGET;
  return positiveInt(raw, CARDSIGHT_PLAN_DEFAULT);
}

export const LIVE_CARDSIGHT_DEFAULTS: LiveCardSightLimits = {
  ...liveCardSightLimitsForPlan(CARDSIGHT_PLAN_DEFAULT),
  perSessionPerMinute: 6,
  dedupeMs: 180_000,
  deadlineMs: 2_500,
  handoffMs: 1_500,
  giveUpMs: 7_000,
};

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Plan-derived caps; each can still be overridden on its own. */
export function liveCardSightLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): LiveCardSightLimits {
  const plan = liveCardSightLimitsForPlan(cardSightPlanFromEnv(env));
  const d = LIVE_CARDSIGHT_DEFAULTS;
  return {
    globalMonthly: plan.globalMonthly,
    perUserDaily: positiveInt(env.CARD_FLOW_LIVE_CARDSIGHT_USER_DAILY, plan.perUserDaily),
    globalDaily: positiveInt(env.CARD_FLOW_LIVE_CARDSIGHT_GLOBAL_DAILY, plan.globalDaily),
    perSessionPerMinute: positiveInt(env.CARD_FLOW_LIVE_CARDSIGHT_SESSION_PER_MIN, d.perSessionPerMinute),
    dedupeMs: positiveInt(env.CARD_FLOW_LIVE_CARDSIGHT_DEDUPE_SECONDS, d.dedupeMs / 1000) * 1000,
    premiumMonthly: positiveInt(env.CARD_FLOW_LIVE_CARDSIGHT_PREMIUM_MONTHLY, plan.premiumMonthly),
    trialMonthly: positiveInt(env.CARD_FLOW_LIVE_CARDSIGHT_TRIAL_MONTHLY, plan.trialMonthly),
    deadlineMs: positiveInt(env.CARD_FLOW_LIVE_CARDSIGHT_DEADLINE_MS, d.deadlineMs),
    handoffMs: positiveInt(env.CARD_FLOW_LIVE_CARDSIGHT_HANDOFF_MS, d.handoffMs),
    giveUpMs: positiveInt(env.CARD_FLOW_LIVE_SCAN_BUDGET_MS, d.giveUpMs),
  };
}

/** Live Scan uses CardSight unless CARD_FLOW_LIVESTREAM_CARDSIGHT is 0/false/off/no. */
export function liveCardSightEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CARD_FLOW_LIVESTREAM_CARDSIGHT?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

export const LIVE_CARDSIGHT_GLOBAL_METER = "cardsight_live";
export const liveCardSightUserMeter = (userId: string) => `cardsight_live_user:${userId}`;
export const liveCardSightUserMonthMeter = (userId: string) => `cardsight_live_user_month:${userId}`;
export const utcMonthKey = (now: Date) => now.toISOString().slice(0, 7);
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
  const inHouse = new Map<string, Array<{ key: string; tcgdexId: string; at: number }>>();
  const sessionStart = new Map<string, { first: number; last: number }>();
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
    /**
     * Note our matcher's top-1 for this card; returns how many of the last 3 frames of the same card
     * agree with it. In-process only, short-lived; our own matcher's output, no CardSight data.
     */
    noteInHouse(userId: string, key: string | null, tcgdexId: string | null): number {
      if (!key || !tcgdexId) return 0;
      const t = nowMs();
      const list = inHouse.get(userId) ?? [];
      const sameCard = (k: string) =>
        key.startsWith("hash:") && k.startsWith("hash:") ? sameCardHash(key.slice(5), k.slice(5)) : k === key;
      const fresh = list.filter((r) => t - r.at < 10_000);
      fresh.push({ key, tcgdexId, at: t });
      inHouse.set(userId, fresh.slice(-20));
      const window = fresh.filter((r) => sameCard(r.key)).slice(-LIVE_INHOUSE_VOTE_WINDOW);
      return window.filter((r) => r.tcgdexId === tcgdexId).length;
    },
    /**
     * Server-side start of this user's scanner session: the first frame, reset after 60 s idle.
     * Used to clamp the phone's cardAgeMs.
     */
    sessionAgeMs(userId: string): number {
      const t = nowMs();
      const row = sessionStart.get(userId);
      if (!row || t - row.last > 60_000) {
        sessionStart.set(userId, { first: t, last: t });
        return 0;
      }
      row.last = t;
      return t - row.first;
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

/**
 * Computer Vision (Oct 21): production frames come from the HLS player buffer
 * (iOS AVPlayerItemVideoOutput), which has no Whatnot overlays, so region masking is OFF by default.
 * Set CARD_FLOW_LIVE_MASK_REGIONS=whatnot (defaults) or a JSON array to turn it on.
 */
export function liveMaskRegionsFromEnv(env: NodeJS.ProcessEnv = process.env): readonly NormRect[] {
  const raw = env.CARD_FLOW_LIVE_MASK_REGIONS?.trim();
  if (!raw || raw === "off" || raw === "0") return [];
  if (raw === "whatnot" || raw === "on" || raw === "1") return WHATNOT_OVERLAY_REGIONS;
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
