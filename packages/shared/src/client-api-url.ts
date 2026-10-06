export interface ClientApiUrlInput {
  configured?: string | null;
  platform: string;
  isDev: boolean;
  isPhysical: boolean;
  defaultUrl: string;
}

function isLanHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}

/**
 * Web uses `EXPO_PUBLIC_API_URL` when it is set.
 * A dev simulator keeps the host loopback default. A phone keeps the configured URL.
 */
export function resolveClientApiUrl(input: ClientApiUrlInput): string {
  const configured = input.configured?.trim().replace(/\/$/, "") ?? "";
  if (input.platform === "web") return configured || input.defaultUrl;
  if (!configured) return input.defaultUrl;
  if (input.isDev && !input.isPhysical) return input.defaultUrl;
  if (!input.isDev) return configured;
  try {
    const url = new URL(configured);
    if (!isLanHostname(url.hostname)) return configured;
    url.port = "8081";
    return url.toString().replace(/\/$/, "");
  } catch {
    return configured;
  }
}
