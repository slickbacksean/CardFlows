import { emailSenderProblems } from "./email-sender";
import { serverPepperProblem } from "./server-pepper";

/**
 * Backend review H3: refuse to start in production without settings that keep abuse limits
 * honest. CARD_FLOW_TRUST_PROXY_HOPS must be set explicitly ("0" when the API faces the
 * internet directly, "1" behind one platform proxy); otherwise per-IP limits are wrong.
 */
export function productionConfigProblems(env: NodeJS.Dict<string | undefined>): string[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  const hops = env.CARD_FLOW_TRUST_PROXY_HOPS?.trim();
  if (!hops || !/^\d+$/.test(hops)) {
    problems.push("CARD_FLOW_TRUST_PROXY_HOPS must be set to the number of proxies in front of the API (0 if none).");
  }
  // A sender that is named but half-configured would silently drop verification codes.
  problems.push(...emailSenderProblems(env));
  // Backend review L3 (P4): email_send_counts keys are HMACs with this pepper.
  const pepper = serverPepperProblem(env);
  if (pepper) problems.push(pepper);
  return problems;
}

/** Not fatal (CI and first deploys run without email), but sign-ups can't verify without it. */
export function productionConfigWarnings(env: NodeJS.Dict<string | undefined>): string[] {
  if (env.NODE_ENV !== "production") return [];
  return env.CARD_FLOW_EMAIL_SENDER?.trim()
    ? []
    : ["CARD_FLOW_EMAIL_SENDER is not set: verification and reset codes are not emailed, so new sign-ups can't verify or get pre-grade estimates."];
}

export function assertProductionConfig(env: NodeJS.Dict<string | undefined> = process.env): void {
  const problems = productionConfigProblems(env);
  if (problems.length > 0) throw new Error(`CardFlow API refused to start: ${problems.join(" ")}`);
  for (const warning of productionConfigWarnings(env)) console.warn(`[config] ${warning}`);
}
