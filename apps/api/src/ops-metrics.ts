/**
 * P1-17: in-process server observability.
 * - Per-route p50/p95 latency and error rate (route pattern, never raw paths or ids).
 * - Vendor response counters (401 = bad key, 5xx) with alerts.
 * - Alerts go to Sentry (if configured) and to CARD_FLOW_ALERT_WEBHOOK_URL (Slack-compatible {text}).
 */
export const OPS_WINDOW_MS = 5 * 60_000;
const SAMPLES_PER_ROUTE = 1000;
const ALERT_COOLDOWN_MS = 30 * 60_000;
export const ERROR_SPIKE_MIN_REQUESTS = 20;
export const ERROR_SPIKE_RATE = 0.05;

export type OpsAlertKind =
  | "vendor_401"
  | "vendor_5xx"
  | "server_5xx_spike"
  | "pokecollector_deletion_failed"
  | "cardsight_budget_80"
  | "cardsight_live_daily_50"
  | "cardsight_live_daily_75"
  | "cardsight_live_daily_90"
  | "volume_disk_70"
  | "volume_disk_85";

export interface OpsAlert {
  kind: OpsAlertKind;
  key: string;
  message: string;
  at: string;
}

interface Sample {
  at: number;
  ms: number;
  status: number;
}

export interface RouteStats {
  route: string;
  count: number;
  errors5xx: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

export class OpsMetrics {
  private readonly routes = new Map<string, Sample[]>();
  private readonly vendor = new Map<string, Sample[]>();
  private readonly lastAlertAt = new Map<string, number>();
  private readonly device = new Map<string, Array<Sample & { hot: boolean }>>();
  readonly alerts: OpsAlert[] = [];

  constructor(
    private readonly sinks: Array<(alert: OpsAlert) => void> = [],
    private readonly now: () => number = Date.now,
  ) {}

  addSink(sink: (alert: OpsAlert) => void) {
    this.sinks.push(sink);
  }

  recordRequest(route: string, status: number, ms: number) {
    const list = this.routes.get(route) ?? [];
    list.push({ at: this.now(), ms, status });
    if (list.length > SAMPLES_PER_ROUTE) list.shift();
    this.routes.set(route, list);
    if (status >= 500) this.checkErrorSpike();
  }

  recordVendorResponse(vendor: string, status: number) {
    const list = this.vendor.get(vendor) ?? [];
    list.push({ at: this.now(), ms: 0, status });
    if (list.length > SAMPLES_PER_ROUTE) list.shift();
    this.vendor.set(vendor, list);
    if (status === 401 || status === 403) {
      this.alert("vendor_401", `vendor_401:${vendor}`, `${vendor} rejected our API key (HTTP ${status}). Check the key.`);
    } else if (status >= 500) {
      const recent = this.recent(list);
      const bad = recent.filter((s) => s.status >= 500).length;
      if (bad >= 5) this.alert("vendor_5xx", `vendor_5xx:${vendor}`, `${vendor} returned ${bad} server errors in 5 minutes.`);
    }
  }

  /** P1-18: on-device stage timings, keyed by stage and device class. */
  /** Backend final review R3: a PokéCollector delete gave up (max attempts). Counted and alerted. */
  pokecollectorDeletionsFailed = 0;
  recordPokecollectorDeletionFailed() {
    this.pokecollectorDeletionsFailed += 1;
    this.alert(
      "pokecollector_deletion_failed",
      "pokecollector_deletion_failed",
      "A PokéCollector account deletion gave up after the maximum attempts. See /ops/pokecollector-deletions and RELEASE_ENV.",
    );
  }

  /** Sean (Oct 18): warn near the free-plan CardSight hard stop (~80% of monthly cap). */
  recordCardSightBudgetUsage(used: number, cap: number) {
    if (cap <= 0 || used < Math.ceil(cap * 0.8)) return;
    const pct = Math.round((used / cap) * 100);
    this.alert(
      "cardsight_budget_80",
      "cardsight_budget_80",
      `CardSight monthly usage is at ${used}/${cap} (~${pct}%). Free plan hard-stops at the cap.`,
    );
  }

  /**
   * Sean (Oct 21): Live Scan engine counters, aggregate only (no ids, no per-scan rows).
   * agree/disagree compare our matcher with CardSight only when CardSight was called anyway.
   */
  readonly liveEngine = { in_house: 0, cardsight: 0, in_house_only: 0, agree: 0, disagree: 0 };
  recordLiveEngine(engine: "in_house" | "cardsight" | "in_house_only", agree: boolean | null) {
    this.liveEngine[engine] += 1;
    if (agree === true) this.liveEngine.agree += 1;
    else if (agree === false) this.liveEngine.disagree += 1;
  }

  /**
   * Sean (Oct 21): Live Scan CardSight app-wide daily meter. Alerts once per level per day at
   * 50%, 75% and 90% of CARD_FLOW_LIVE_CARDSIGHT_GLOBAL_DAILY.
   */
  recordLiveCardSightDailyUsage(used: number, cap: number, dayKey: string) {
    if (!(cap > 0)) return;
    const pct = (used / cap) * 100;
    const level = pct >= 90 ? 90 : pct >= 75 ? 75 : pct >= 50 ? 50 : 0;
    if (level === 0) return;
    const kind = `cardsight_live_daily_${level}` as OpsAlertKind;
    this.alert(
      kind,
      `${kind}:${dayKey}`,
      `Live Scan CardSight usage today (${dayKey} UTC) is at ${used}/${cap} (${Math.round(pct)}%). Live Scan stops calling CardSight at the cap.`,
    );
  }

  /**
   * Dev Ops (Oct 19): data volume fill alerts at 70% and 85%. Each level alerts once when it is
   * crossed (not on every check) and re-arms after usage drops back below it.
   */
  private diskLevel = 0;
  recordDiskUsage(usedBytes: number, totalBytes: number) {
    if (!(totalBytes > 0)) return;
    const fraction = usedBytes / totalBytes;
    const level = fraction >= 0.85 ? 85 : fraction >= 0.7 ? 70 : 0;
    const previous = this.diskLevel;
    this.diskLevel = level;
    if (level === 0 || level <= previous) return;
    const pct = Math.round(fraction * 100);
    const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
    const detail = `Data volume is ${pct}% full (${gb(usedBytes)} of ${gb(totalBytes)} GB).`;
    if (level === 85) {
      this.alert("volume_disk_85", "volume_disk_85", `${detail} Grow the volume or free space now.`);
    } else {
      this.alert("volume_disk_70", "volume_disk_70", `${detail} Plan to grow the volume.`);
    }
  }

  recordDeviceStage(stage: string, deviceClass: string, ms: number, hot: boolean) {
    const key = `${stage}|${deviceClass}`;
    const list = this.device.get(key) ?? [];
    list.push({ at: this.now(), ms, status: 200, hot });
    if (list.length > SAMPLES_PER_ROUTE) list.shift();
    this.device.set(key, list);
  }

  private recent<T extends Sample>(list: readonly T[]): T[] {
    const cutoff = this.now() - OPS_WINDOW_MS;
    return list.filter((s) => s.at >= cutoff);
  }

  private checkErrorSpike() {
    const all = [...this.routes.values()].flatMap((l) => this.recent(l));
    const bad = all.filter((s) => s.status >= 500).length;
    if (all.length >= ERROR_SPIKE_MIN_REQUESTS && bad / all.length >= ERROR_SPIKE_RATE) {
      this.alert(
        "server_5xx_spike",
        "server_5xx_spike",
        `API 5xx rate is ${Math.round((bad / all.length) * 100)}% (${bad}/${all.length}) over 5 minutes.`,
      );
    }
  }

  private alert(kind: OpsAlertKind, key: string, message: string) {
    const t = this.now();
    const last = this.lastAlertAt.get(key);
    if (last !== undefined && t - last < ALERT_COOLDOWN_MS) return;
    this.lastAlertAt.set(key, t);
    const alert = { kind, key, message, at: new Date(t).toISOString() };
    this.alerts.push(alert);
    if (this.alerts.length > 100) this.alerts.shift();
    for (const sink of this.sinks) {
      try {
        sink(alert);
      } catch {
        // An alert sink must never break a request.
      }
    }
  }

  snapshot() {
    const routes: RouteStats[] = [...this.routes.entries()].map(([route, list]) => {
      const recent = this.recent(list);
      const sorted = recent.map((s) => s.ms).sort((a, b) => a - b);
      const errors5xx = recent.filter((s) => s.status >= 500).length;
      return {
        route,
        count: recent.length,
        errors5xx,
        errorRate: recent.length ? errors5xx / recent.length : 0,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
      };
    });
    const vendors = [...this.vendor.entries()].map(([vendor, list]) => {
      const recent = this.recent(list);
      return {
        vendor,
        count: recent.length,
        unauthorized: recent.filter((s) => s.status === 401 || s.status === 403).length,
        errors5xx: recent.filter((s) => s.status >= 500).length,
      };
    });
    const devices = [...this.device.entries()].map(([key, list]) => {
      const [stage, deviceClass] = key.split("|");
      const day = list.filter((s) => s.at >= this.now() - 24 * 60 * 60_000);
      const sorted = day.map((s) => s.ms).sort((a, b) => a - b);
      const hot = day.filter((s) => s.hot);
      return {
        stage,
        deviceClass,
        count: day.length,
        p95Ms: percentile(sorted, 95),
        hotShare: day.length ? hot.length / day.length : 0,
        hotP95Ms: percentile(hot.map((s) => s.ms).sort((a, b) => a - b), 95),
      };
    });
    return {
      windowMs: OPS_WINDOW_MS,
      devices,
      routes: routes.sort((a, b) => a.route.localeCompare(b.route)),
      vendors,
      pokecollectorDeletionsFailed: this.pokecollectorDeletionsFailed,
      alerts: [...this.alerts],
      liveEngine: { ...this.liveEngine },
    };
  }
}

/** Slack-compatible incoming webhook (also works with most chat/email relays). */
export function webhookAlertSink(url: string, fetchImpl: typeof fetch = fetch) {
  return (alert: OpsAlert) => {
    void fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `CardFlow alert: ${alert.message}` }),
    }).catch(() => undefined);
  };
}

export const opsMetrics = new OpsMetrics();

/** Records a vendor response on the shared metrics (used by the HTTP adapters). */
export function recordVendorResponse(vendor: string, status: number) {
  opsMetrics.recordVendorResponse(vendor, status);
}
