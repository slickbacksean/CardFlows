/**
 * P1-21: status banners from provider health and feature flags. Copy comes from
 * the server (`GET /v1/status`); the phone only renders it. Copy is pending
 * Community & CS sign-off.
 */
export type StatusBannerId = "pricing_delayed" | "pregrade_unavailable" | "identify_degraded" | "ops_notice";

export interface StatusBanner {
  id: StatusBannerId;
  message: string;
  severity: "info" | "warning";
}

export const STATUS_BANNER_COPY: Record<Exclude<StatusBannerId, "ops_notice">, string> = {
  pricing_delayed: "Prices are delayed right now. You can enter your own.",
  pregrade_unavailable: "Pre-grade estimates are unavailable right now. Try again later.",
  identify_degraded: "Card matching is slower right now. You can search by name or number.",
};

export const STATUS_POLL_MS = 60_000;

export interface StatusInputs {
  /** Pricing flag/provider: "off" or a provider name. */
  pricingProvider: string;
  /** Pricing provider answered errors recently (circuit open). */
  pricingUnhealthy?: boolean;
  gradeEstimate: string;
  /** Grader engine probe; null when not probed. */
  gradeEngineOk: boolean | null;
  recognitionUnhealthy?: boolean;
  /** Optional operator message (`CARD_FLOW_STATUS_MESSAGE`), trimmed to 140 chars. */
  opsMessage?: string | null;
}

export function statusBanners(input: StatusInputs): StatusBanner[] {
  const out: StatusBanner[] = [];
  if (input.pricingProvider === "off" || input.pricingUnhealthy) {
    out.push({ id: "pricing_delayed", message: STATUS_BANNER_COPY.pricing_delayed, severity: "info" });
  }
  if (input.gradeEstimate === "off" || input.gradeEngineOk === false) {
    out.push({ id: "pregrade_unavailable", message: STATUS_BANNER_COPY.pregrade_unavailable, severity: "warning" });
  }
  if (input.recognitionUnhealthy) {
    out.push({ id: "identify_degraded", message: STATUS_BANNER_COPY.identify_degraded, severity: "info" });
  }
  const ops = input.opsMessage?.trim();
  if (ops) out.push({ id: "ops_notice", message: ops.slice(0, 140), severity: "info" });
  return out;
}
