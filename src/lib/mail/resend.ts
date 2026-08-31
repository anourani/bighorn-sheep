import type { Mailer, Message, SendResult } from "./types";

const RESEND_BATCH = "https://api.resend.com/emails/batch";

/**
 * Resend's batch limit, and the reason the send is chunked at all.
 *
 * VERIFY THIS AGAINST RESEND'S CURRENT DOCS if you touch this file — it could
 * not be checked when this was written (resend.com is unreachable from the
 * agent sandbox's egress proxy). 100 is the documented figure as of writing and
 * is far above this league's size, so the chunking below has never actually
 * fired in production; it exists so that the day it does, the behaviour is
 * "several requests" rather than a 400 from the provider.
 */
export const RESEND_MAX_BATCH = 100;

export interface ResendMailerOptions {
  apiKey: string;
  /** "Name <address@domain>". Must be on a domain verified with Resend. */
  from: string;
  /** Abort a request after this many ms (default 8000, matching EspnProvider). */
  timeoutMs?: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface ResendBatchResponse {
  data?: { id?: string }[];
  message?: string;
  name?: string;
}

/**
 * The transactional sender, as a raw `fetch` rather than the `resend` package.
 *
 * Four reasons, in this repo's own terms: it runs on eight runtime dependencies
 * and is documented as conservative about a ninth; `EspnProvider` already
 * establishes that no caller touches a vendor SDK directly, and this is that
 * same seam; the SDK saves about fifteen lines over one POST; and Netlify
 * bundles with esbuild, so every dependency is cold-start weight in a path that
 * has to finish inside the platform's synchronous limit.
 *
 * BATCH, not one request per recipient, and the reason is the rate limit rather
 * than elegance. Resend's default allowance is a couple of requests a second, so
 * thirty sequential sends paced to it is roughly fifteen seconds — past
 * Netlify's synchronous function ceiling, which means the action returns a
 * failure to the admin AFTER the mail has already gone out. One batch call is
 * one rate-limit unit and about a second.
 */
export class ResendMailer implements Mailer {
  readonly name = "resend";
  private readonly apiKey: string;
  private readonly from: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ResendMailerOptions) {
    this.apiKey = opts.apiKey;
    this.from = opts.from;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async sendBatch(messages: Message[]): Promise<SendResult[]> {
    if (messages.length === 0) return [];

    const results: SendResult[] = [];
    for (let i = 0; i < messages.length; i += RESEND_MAX_BATCH) {
      const chunk = messages.slice(i, i + RESEND_MAX_BATCH);
      results.push(...(await this.sendOneBatch(chunk)));
    }
    return results;
  }

  private async sendOneBatch(chunk: Message[]): Promise<SendResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(RESEND_BATCH, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          chunk.map((m) => ({
            from: this.from,
            to: [m.to],
            subject: m.subject,
            html: m.html,
            text: m.text,
          })),
        ),
      });

      if (!res.ok) {
        // The whole chunk was refused. Throw rather than returning per-recipient
        // errors: nothing was sent, so the caller must NOT write log rows that
        // would suppress the retry. See runReminderSend's chunk handling.
        const detail = await safeText(res);
        throw new Error(`Resend responded ${res.status}${detail ? `: ${detail}` : ""}`);
      }

      const payload = (await res.json()) as ResendBatchResponse;
      const data = Array.isArray(payload.data) ? payload.data : [];

      // Ids come back POSITIONALLY, which is what lets a batch still produce a
      // per-recipient log row. A short or absent array is not an error — the
      // send succeeded, we simply cannot attribute an id.
      return chunk.map((_, i) => ({
        providerId: typeof data[i]?.id === "string" ? (data[i]?.id as string) : null,
        error: null,
      }));
    } finally {
      clearTimeout(timer);
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * Renders and logs, sends nothing — `MockProvider`'s analogue.
 *
 * This is what `REMINDER_DRY_RUN=1` selects, and what the job falls back to so
 * a developer can exercise the whole path without a key. It reports success for
 * every message, so the ONLY thing separating a dry run from a real one is
 * whether log rows are written — which is why `runReminderSend` refuses to write
 * them when `dryRun` is set. Writing them would burn the idempotence keys and
 * silently suppress the real send afterwards.
 */
export class LogMailer implements Mailer {
  readonly name = "log";

  async sendBatch(messages: Message[]): Promise<SendResult[]> {
    for (const m of messages) {
      console.log(`[reminders] would send to ${m.to}: ${m.subject}`);
    }
    return messages.map(() => ({ providerId: null, error: null }));
  }
}
