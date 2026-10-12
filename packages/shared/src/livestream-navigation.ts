/**
 * Whatnot's mobile site replaces a live show with an app handoff
 * ("Continue in app" / "Continue on Whatnot") and does not mount a player.
 * The same show URL with a desktop user agent plays in the page.
 */

export const LIVESTREAM_DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

const APP_STORE_HOSTS = new Set(["play.google.com", "apps.apple.com", "itunes.apple.com"]);

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function livestreamUsesDesktopSite(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  return host === "whatnot.com" || host.endsWith(".whatnot.com");
}

export function livestreamWebViewUserAgent(url: string): string | null {
  if (livestreamUsesDesktopSite(url)) return LIVESTREAM_DESKTOP_USER_AGENT;
  return null;
}

/** Top-level navigations that should stay inside the livestream page. */
export function allowLivestreamNavigation(url: string): boolean {
  if (url === "about:blank") return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (APP_STORE_HOSTS.has(host)) return false;
  if (host === "onelink.me" || host.endsWith(".onelink.me")) return false;
  if (host === "app.link" || host.endsWith(".app.link")) return false;
  return true;
}
