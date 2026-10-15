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

export type OpsAlertKind = "vendor_401" | "vendor_5xx" | "server_5xx_spike";

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
    return { windowMs: OPS_WINDOW_MS, devices, routes: routes.sort((a, b) => a.route.localeCompare(b.route)), vendors, alerts: [...this.alerts] };
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
