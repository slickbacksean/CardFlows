/** Client wait for a CardFlow HTTP call. */
export const CARD_FLOW_REQUEST_TIMEOUT_MS = 15_000;

/** Shown when the phone cannot complete the request. */
export const CARD_FLOW_UNREACHABLE_MESSAGE = "Can't reach CardFlow.";

const JSON_PARSE_ERROR = /unexpected token|json parse|syntaxerror|unexpected end of (json|input)/i;

export function cardFlowUnreachableMessage(devDetail?: string | null): string {
  const detail = typeof devDetail === "string" ? devDetail.trim() : "";
  if (!detail || JSON_PARSE_ERROR.test(detail)) return CARD_FLOW_UNREACHABLE_MESSAGE;
  return `${CARD_FLOW_UNREACHABLE_MESSAGE} ${detail}`;
}

/**
 * User-facing message for a failed HTTP response.
 * A server `error` string is kept when it is already plain language.
 */
export function cardFlowHttpErrorMessage(status: number, serverError?: string | null): string {
  const server = typeof serverError === "string" ? serverError.trim() : "";
  if (server && !JSON_PARSE_ERROR.test(server)) return server;
  if (status === 400) return "That request was not valid.";
  if (status === 401 || status === 403) return "CardFlow could not authorize that request.";
  if (status === 404) return "That item was not found.";
  if (status === 408 || status === 504) return "CardFlow took too long to answer.";
  if (status === 429) return "CardFlow is busy. Try again in a moment.";
  if (status >= 500) return "CardFlow couldn't finish that request.";
  return "CardFlow couldn't finish that request.";
}
