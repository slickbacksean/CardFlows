/**
 * Provider-agnostic transactional email (verification codes, password resets).
 *
 *   CARD_FLOW_EMAIL_SENDER=resend  → Resend HTTP API (RESEND_API_KEY, CARD_FLOW_EMAIL_FROM)
 *   unset                          → no email; outside production the code is logged for dev
 *
 * Adding a provider means adding one `case` that returns an `EmailSender`; the routes never
 * know which provider is in use. Secrets and codes are never logged in production.
 */
export type EmailKind = "verify-email" | "password-reset";

export interface EmailMessage {
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  /** The code inside `text` (only the dev logger prints it; tests read it). */
  code: string;
}

export interface EmailSender {
  readonly name: string;
  /** Resolves false when the provider refused or failed; never throws. */
  send(message: EmailMessage): Promise<boolean>;
}

type Env = NodeJS.Dict<string | undefined>;
type Fetch = typeof fetch;

export const EMAIL_SENDERS = ["resend"] as const;
export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Settings problems (production-config refuses to start on these). */
export function emailSenderProblems(env: Env): string[] {
  const kind = env.CARD_FLOW_EMAIL_SENDER?.trim();
  if (!kind) return [];
  if (!(EMAIL_SENDERS as readonly string[]).includes(kind)) {
    return [`CARD_FLOW_EMAIL_SENDER must be one of: ${EMAIL_SENDERS.join(", ")} (got "${kind}").`];
  }
  const problems: string[] = [];
  if (!env.RESEND_API_KEY?.trim()) problems.push("RESEND_API_KEY is required when CARD_FLOW_EMAIL_SENDER=resend.");
  if (!env.CARD_FLOW_EMAIL_FROM?.trim()) {
    problems.push('CARD_FLOW_EMAIL_FROM is required when CARD_FLOW_EMAIL_SENDER=resend (e.g. "PokeSniper <TODO-sender@pokesniper.app>").');
  }
  return problems;
}

export function createResendSender(opts: { apiKey: string; from: string; fetchImpl?: Fetch; timeoutMs?: number }): EmailSender {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: "resend",
    async send(message) {
      try {
        const res = await doFetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from: opts.from, to: [message.to], subject: message.subject, text: message.text }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        });
        if (!res.ok) console.warn(`[email] resend refused ${message.kind} email: HTTP ${res.status}`);
        return res.ok;
      } catch (error) {
        console.warn(`[email] resend ${message.kind} email failed: ${error instanceof Error ? error.name : "error"}`);
        return false;
      }
    },
  };
}

/** No provider: logs the code outside production (dev/test), and only a warning in production. */
export function createDevLogSender(env: Env = process.env): EmailSender {
  return {
    name: "dev-log",
    async send(message) {
      if (env.NODE_ENV === "production") {
        console.warn(`[email] no CARD_FLOW_EMAIL_SENDER configured; ${message.kind} email not sent.`);
        return false;
      }
      console.info(`[email] dev only, no email sender: ${message.kind} code for ${message.to}: ${message.code}`);
      return true;
    },
  };
}

export function emailSenderFromEnv(env: Env = process.env, fetchImpl?: Fetch): EmailSender {
  const problems = emailSenderProblems(env);
  if (problems.length > 0) {
    console.warn(`[email] ${problems.join(" ")} Falling back to the dev logger.`);
    return createDevLogSender(env);
  }
  if (env.CARD_FLOW_EMAIL_SENDER?.trim() === "resend") {
    return createResendSender({ apiKey: env.RESEND_API_KEY!.trim(), from: env.CARD_FLOW_EMAIL_FROM!.trim(), fetchImpl });
  }
  return createDevLogSender(env);
}
