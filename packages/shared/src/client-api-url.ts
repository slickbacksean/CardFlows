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

/** Loopback, emulator-host, link-local, private-LAN or mDNS hosts: never valid in a release build. */
export function isLoopbackOrLanHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "::1" || host === "0.0.0.0" || host.endsWith(".local") || host.endsWith(".localhost")) return true;
  if (/^127\./.test(host) || /^169\.254\./.test(host)) return true;
  return isLanHostname(host);
}

export type ReleaseApiUrlProblem = "missing" | "invalid" | "loopback";

/**
 * Dev Ops review (P4, blocking): a release build (`!__DEV__`) must have a real
 * `EXPO_PUBLIC_API_URL`. Null when fine (and always null in dev, which uses the local API).
 */
export function releaseApiUrlProblem(input: { configured?: string | null; isDev: boolean }): ReleaseApiUrlProblem | null {
  if (input.isDev) return null;
  const configured = input.configured?.trim() ?? "";
  if (!configured) return "missing";
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "invalid";
    return isLoopbackOrLanHost(url.hostname) ? "loopback" : null;
  } catch {
    return "invalid";
  }
}

export class ReleaseApiUrlError extends Error {
  constructor(readonly problem: ReleaseApiUrlProblem) {
    super(`EXPO_PUBLIC_API_URL is ${problem} in a release build`);
    this.name = "ReleaseApiUrlError";
  }
}

/** Shown by the root layout instead of the app when a release build has no usable API URL. */
export const RELEASE_API_URL_ERROR_COPY = {
  title: "CardFlow can't connect",
  body: "This build isn't set up to reach CardFlow's servers. Install the latest version from the App Store or Google Play.",
} as const;

/**
 * Web uses `EXPO_PUBLIC_API_URL` when it is set.
 * A dev simulator keeps the host loopback default. A phone keeps the configured URL.
 */
export function resolveClientApiUrl(input: ClientApiUrlInput): string {
  const configured = input.configured?.trim().replace(/\/$/, "") ?? "";
  // Dev Ops review: checked before any default, so a release build never falls back to
  // 127.0.0.1 / 10.0.2.2. The root layout shows RELEASE_API_URL_ERROR_COPY first.
  const problem = releaseApiUrlProblem({ configured, isDev: input.isDev });
  if (problem) throw new ReleaseApiUrlError(problem);
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
