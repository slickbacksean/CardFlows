const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export const REQUEST_ID_HEADER = "x-request-id";

/** Echo a safe client id, otherwise mint one. */
export function resolveRequestId(incoming?: string | null): string {
  const value = incoming?.trim();
  if (value && REQUEST_ID_PATTERN.test(value)) return value;
  return crypto.randomUUID();
}
