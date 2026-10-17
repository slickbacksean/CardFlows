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
  return problems;
}

export function assertProductionConfig(env: NodeJS.Dict<string | undefined> = process.env): void {
  const problems = productionConfigProblems(env);
  if (problems.length > 0) throw new Error(`CardFlow API refused to start: ${problems.join(" ")}`);
}
