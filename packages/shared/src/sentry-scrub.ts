/** Shared Sentry beforeSend: never ship photos, image bytes, or emails. */

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BASE64_LIKE = /^[A-Za-z0-9+/=\s]{200,}$/;
const IMAGE_DATA_URL = /data:image\/[a-zA-Z0-9.+-]+;base64,/i;

const DROP_KEY_PATTERN =
  /^(email|emails|photo|photos|image|images|jpeg|jpg|png|webp|heic|base64|crop|cropbytes|frontbytes|backbytes|identitycropjpeg|still|screenshot|screenshots|file|files|attachment|attachments|authorization|cookie|cookies|set-cookie)$/i;

const DROP_HEADER_PATTERN = /^(authorization|cookie|set-cookie|x-api-key)$/i;

export const REDACTED_EMAIL = "[redacted-email]";
export const REDACTED_IMAGE = "[image-data-redacted]";
export const REDACTED_VALUE = "[redacted]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeImageData(value: string): boolean {
  if (IMAGE_DATA_URL.test(value)) return true;
  if (value.length >= 200 && BASE64_LIKE.test(value)) return true;
  return false;
}

function scrubString(value: string): string {
  if (looksLikeImageData(value)) return REDACTED_IMAGE;
  return value.replace(EMAIL_PATTERN, REDACTED_EMAIL);
}

function dropKey(key: string): boolean {
  return DROP_KEY_PATTERN.test(key);
}

function scrubUnknown(value: unknown, key?: string): unknown {
  if (key && dropKey(key)) return REDACTED_VALUE;
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => scrubUnknown(item));
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (dropKey(childKey)) {
      out[childKey] = REDACTED_VALUE;
      continue;
    }
    out[childKey] = scrubUnknown(child, childKey);
  }
  return out;
}

function scrubRequest(request: Record<string, unknown>): Record<string, unknown> {
  const headers = isRecord(request.headers) ? { ...request.headers } : undefined;
  if (headers) {
    for (const name of Object.keys(headers)) {
      if (DROP_HEADER_PATTERN.test(name)) headers[name] = REDACTED_VALUE;
      else if (typeof headers[name] === "string") headers[name] = scrubString(headers[name]);
    }
  }
  return {
    ...request,
    data: request.data === undefined ? undefined : REDACTED_VALUE,
    cookies: request.cookies === undefined ? undefined : REDACTED_VALUE,
    headers,
    url: typeof request.url === "string" ? scrubString(request.url) : request.url,
    query_string:
      typeof request.query_string === "string"
        ? scrubString(request.query_string)
        : request.query_string === undefined
          ? undefined
          : REDACTED_VALUE,
  };
}

function scrubUser(user: Record<string, unknown>): Record<string, unknown> {
  const next = { ...user };
  delete next.email;
  delete next.ip_address;
  if (typeof next.username === "string") next.username = scrubString(next.username);
  return next;
}

/**
 * Clone and scrub a Sentry event. Always drops request bodies, emails, and
 * anything that looks like photo/image bytes. Returns null only if the payload
 * cannot be cloned; callers should treat that as "drop the event".
 */
export function scrubSentryEvent<T>(event: T): T | null {
  try {
    const cloned = JSON.parse(JSON.stringify(event)) as unknown;
    if (!isRecord(cloned)) return cloned as T;

    if (isRecord(cloned.user)) cloned.user = scrubUser(cloned.user);
    if (isRecord(cloned.request)) cloned.request = scrubRequest(cloned.request);
    if (cloned.extra !== undefined) cloned.extra = scrubUnknown(cloned.extra);
    if (cloned.contexts !== undefined) cloned.contexts = scrubUnknown(cloned.contexts);
    if (cloned.breadcrumbs !== undefined) cloned.breadcrumbs = scrubUnknown(cloned.breadcrumbs);
    if (cloned.exception !== undefined) cloned.exception = scrubUnknown(cloned.exception);
    if (typeof cloned.message === "string") cloned.message = scrubString(cloned.message);

    return cloned as T;
  } catch {
    return null;
  }
}
