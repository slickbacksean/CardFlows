/**
 * Sean (Oct 25): Email provider abstraction for newsletters with Resend as default.
 * Dry-run mode when RESEND_API_KEY is missing.
 */

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  dryRun?: boolean;
}

export interface EmailProviderPort {
  send(message: EmailMessage): Promise<EmailSendResult>;
  getRateLimits(): { maxPerSecond: number; maxPerDay: number };
}

class ResendProvider implements EmailProviderPort {
  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          headers: message.headers,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Resend API error: ${response.status} ${errorText}`,
        };
      }

      const data = (await response.json()) as { id: string };
      return {
        success: true,
        messageId: data.id,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  getRateLimits() {
    return { maxPerSecond: 10, maxPerDay: 100_000 };
  }
}

class DryRunProvider implements EmailProviderPort {
  private previewPath = "/tmp/newsletter-preview.html";

  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.log("[DRY RUN] Would send email:");
    console.log(`  From: ${message.from}`);
    console.log(`  To: ${message.to}`);
    console.log(`  Subject: ${message.subject}`);
    if (message.headers) {
      console.log(`  Headers:`, message.headers);
    }

    await import("node:fs/promises").then((fs) =>
      fs.writeFile(this.previewPath, message.html, "utf-8")
    );
    console.log(`  Preview saved to: ${this.previewPath}`);

    return {
      success: true,
      messageId: `dry-run-${Date.now()}`,
      dryRun: true,
    };
  }

  getRateLimits() {
    return { maxPerSecond: 1000, maxPerDay: 1_000_000 };
  }
}

export function createEmailProvider(env: {
  RESEND_API_KEY?: string;
}): EmailProviderPort {
  if (env.RESEND_API_KEY) {
    return new ResendProvider(env.RESEND_API_KEY);
  }
  console.warn("[EMAIL] No RESEND_API_KEY - running in dry-run mode");
  return new DryRunProvider();
}
