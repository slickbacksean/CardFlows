type Env = Record<string, string | undefined>;

/** Browser origins allowed to call the API. Native apps do not send Origin. */
export function corsOriginsFromEnv(env: Env = process.env): string[] {
  const raw = env.CARD_FLOW_CORS_ORIGINS ?? "";
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const origin = part.trim().replace(/\/$/, "");
    if (!origin) continue;
    seen.add(origin);
  }
  return [...seen];
}
