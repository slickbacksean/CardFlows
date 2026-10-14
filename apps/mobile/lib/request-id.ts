/** Safe request id for `x-request-id`. Matches the API allowlist. */
export function createRequestId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

let lastId: string | null = null;

export function rememberRequestId(id: string): void {
  lastId = id;
}

/** Last API request id from this process. Used later by "Report this scan". */
export function lastRequestId(): string | null {
  return lastId;
}
