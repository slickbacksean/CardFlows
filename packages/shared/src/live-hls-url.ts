/**
 * Playlist URL the in-app live page already requested.
 * A native player decodes it. This is not a still of the page.
 */

const MAX_URL_LENGTH = 2048;

export function normalizeLiveHlsUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 12 || trimmed.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1") return null;
  const haystack = `${url.pathname}${url.search}`.toLowerCase();
  if (!haystack.includes(".m3u8")) return null;
  return url.toString();
}

export function liveHlsUrlFromWebMessage(raw: unknown): string | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.rawMessage === "string") {
    return liveHlsUrlFromWebMessage(record.rawMessage);
  }
  const nested =
    record.detail && typeof record.detail === "object"
      ? (record.detail as Record<string, unknown>)
      : null;
  const cardflow = record.cardflow ?? nested?.cardflow;
  if (cardflow !== "hls") return null;
  return normalizeLiveHlsUrl(record.url ?? nested?.url);
}

/**
 * Runs in the live page before its scripts. Reports https .m3u8 URLs only.
 * Idempotent. Does not read pixels.
 */
export const LIVE_HLS_REPORT_SCRIPT = `(function () {
  if (window.__cardflowHls) return;
  window.__cardflowHls = true;
  function report(value) {
    try {
      var url = String(value || "");
      if (url.toLowerCase().indexOf(".m3u8") === -1) return;
      if (url.indexOf("https://") !== 0) return;
      var payload = { cardflow: "hls", url: url };
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
      if (window.mobileApp && window.mobileApp.postMessage) {
        window.mobileApp.postMessage(payload);
      }
    } catch (e) {}
  }
  function watch(el) {
    if (!el || el.__cardflowHlsWatch) return;
    el.__cardflowHlsWatch = true;
    report(el.currentSrc || el.src);
    el.addEventListener("loadedmetadata", function () {
      report(el.currentSrc || el.src);
    });
    el.addEventListener("play", function () {
      report(el.currentSrc || el.src);
    });
  }
  var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (proto) {
    var desc = Object.getOwnPropertyDescriptor(proto, "src");
    if (desc && desc.set && desc.get) {
      Object.defineProperty(proto, "src", {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (value) {
          report(value);
          return desc.set.call(this, value);
        },
      });
    }
  }
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        report(typeof input === "string" ? input : input && input.url);
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }
  var xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      report(url);
    } catch (e) {}
    return xhrOpen.apply(this, arguments);
  };
  function scan() {
    if (!document.querySelectorAll) return;
    var nodes = document.querySelectorAll("video, audio, source");
    for (var i = 0; i < nodes.length; i++) watch(nodes[i]);
  }
  scan();
  var obs = new MutationObserver(scan);
  function start() {
    if (!document.documentElement) return;
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  }
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
true;`;
