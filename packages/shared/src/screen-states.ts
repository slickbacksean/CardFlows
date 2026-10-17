/**
 * P5 UX polish: one set of empty / loading / error states for every main
 * screen (Scan, Grade, MyDEX, Collection, Settings, Sign-up / Verify email).
 * Plain copy, one retry label, and separate offline, can't-reach, timeout,
 * busy and server-error messages. Pure functions; the app's
 * components/ui/screen-state.tsx renders them.
 */
import { CARD_FLOW_UNREACHABLE_MESSAGE } from "./cardflow-http-error";

export const SCREEN_STATE_COPY = {
  retry: "Try again",
  retrying: "Trying again…",
  loading: "Loading…",
  offlineTitle: "You're offline",
  offlineBody: "Check your connection, then try again.",
  unreachableTitle: "Can't reach CardFlow",
  unreachableBody: "Your connection looks fine. CardFlow may be down for a moment. Try again shortly.",
  timeoutTitle: "That took too long",
  timeoutBody: "CardFlow didn't answer in time. Try again.",
  busyTitle: "CardFlow is busy",
  busyBody: "Too many requests right now. Try again in a moment.",
  serverTitle: "Something went wrong on our end",
  serverBody: "It's not you. Try again in a moment.",
  authTitle: "Sign in again",
  authBody: "Your session ended. Sign in, then try again.",
  unknownBody: "Try again. If it keeps happening, close and reopen the app.",
} as const;

export type LoadErrorKind = "offline" | "unreachable" | "timeout" | "busy" | "server" | "auth" | "unknown";

/** What the app knows about a failed call: the api.ts error fields, plus NetInfo when available. */
export interface LoadErrorInput {
  unreachable?: boolean;
  status?: number;
  message?: string;
}

export function classifyLoadError(error: unknown, connected: boolean | null = null): LoadErrorKind {
  const e = (error && typeof error === "object" ? error : {}) as LoadErrorInput;
  const unreachable =
    e.unreachable === true ||
    (typeof e.message === "string" && e.message.startsWith(CARD_FLOW_UNREACHABLE_MESSAGE));
  if (connected === false) return "offline";
  if (unreachable) return connected === true ? "unreachable" : "offline";
  const status = typeof e.status === "number" ? e.status : null;
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "busy";
  if (status === 401) return "auth";
  if (status != null && status >= 500) return "server";
  return "unknown";
}

export interface LoadErrorCopy {
  kind: LoadErrorKind;
  title: string;
  body: string;
}

/**
 * Full-screen error copy. `what` names the thing that didn't load, in
 * lower case ("your collection"), and is used for the generic title.
 */
export function loadErrorCopy(error: unknown, what: string, connected: boolean | null = null): LoadErrorCopy {
  const kind = classifyLoadError(error, connected);
  const c = SCREEN_STATE_COPY;
  switch (kind) {
    case "offline":
      return { kind, title: c.offlineTitle, body: c.offlineBody };
    case "unreachable":
      return { kind, title: c.unreachableTitle, body: c.unreachableBody };
    case "timeout":
      return { kind, title: c.timeoutTitle, body: c.timeoutBody };
    case "busy":
      return { kind, title: c.busyTitle, body: c.busyBody };
    case "server":
      return { kind, title: c.serverTitle, body: c.serverBody };
    case "auth":
      return { kind, title: c.authTitle, body: c.authBody };
    default:
      return { kind, title: `Couldn't load ${what}`, body: c.unknownBody };
  }
}

/**
 * One-line message for a failed action (save, sign in, scan). Offline and
 * server failures get the plain shared wording; anything else keeps the
 * server's own plain-language message, or the fallback.
 */
export function actionErrorMessage(error: unknown, fallback: string, connected: boolean | null = null): string {
  const kind = classifyLoadError(error, connected);
  const c = SCREEN_STATE_COPY;
  if (kind === "offline") return `${c.offlineTitle}. ${c.offlineBody}`;
  if (kind === "unreachable") return `${c.unreachableTitle}. Try again shortly.`;
  if (kind === "timeout") return c.timeoutBody;
  if (kind === "busy") return `${c.busyTitle}. Try again in a moment.`;
  if (kind === "server") return `${c.serverTitle}. Try again in a moment.`;
  const message = error instanceof Error ? error.message.trim() : "";
  return message || fallback;
}

/** Empty states, one voice. Each says what's missing and the next step. */
export const SCREEN_EMPTY_COPY = {
  noMatches: { title: "No matching cards", body: "Try a different name or number." },
  collectionPurchased: {
    title: "No purchased copies yet",
    body: "Scanning doesn't add cards here. Confirm a card, then mark it Purchased.",
    action: "Scan a card",
  },
  collectionWatchlist: { title: "Nothing on your watchlist", body: "Confirm a card, then tap Watchlist." },
  gradePrepare: {
    title: "No purchased copies yet",
    body: "Scanning doesn't add cards here. Confirm a card, then mark it Purchased.",
    action: "Open MyDEX",
  },
  gradePrepareDone: { title: "No copies left to prepare", body: "Moved copies are on Submitted or Returned." },
  gradeSubmitted: { title: "Nothing submitted", body: "Prepare a purchased copy first." },
  gradeReturned: { title: "Nothing returned yet", body: "Copies you mark Returned show up here." },
} as const;

/** Screen-reader labels for the loading skeletons. */
export const SCREEN_LOADING_LABELS = {
  collection: "Loading your collection",
  grade: "Loading your copies",
  settings: "Checking CardFlow",
  livePage: "Loading the live page",
} as const;

/** What each main screen calls its content in the generic error title. */
export const SCREEN_ERROR_WHAT = {
  collection: "your collection",
  grade: "your copies",
  livePage: "the live page",
} as const;
