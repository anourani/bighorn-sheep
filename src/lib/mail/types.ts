/**
 * The mail seam.
 *
 * The same shape as `src/lib/providers/` and for the same stated reason: no
 * caller touches a vendor SDK directly, so swapping transactional email
 * providers is a one-line change in `index.ts` rather than a grep across the
 * app. Reminders are the first outbound email this project has ever sent —
 * everything before now went through Supabase Auth's own SMTP settings, which
 * no code here can reach — so this is the seam being drawn for the first time.
 */

export interface Message {
  to: string;
  subject: string;
  html: string;
  /**
   * Always populated. An HTML-only message scores badly with spam filters, and
   * this is also what the drawer's preview renders — which is what lets the
   * panel show exactly what will be sent without reaching for
   * `dangerouslySetInnerHTML`.
   */
  text: string;
}

/**
 * One recipient's outcome.
 *
 * Positional: `sendBatch` returns one of these per input message, in order, so
 * a per-recipient log row can be written even though the request was a batch.
 * A mailer that cannot attribute an individual failure must still return an
 * entry per message rather than a short array.
 */
export interface SendResult {
  /** The provider's id for this message, when it gave one. */
  providerId: string | null;
  /** Null on success. A human-readable reason on failure. */
  error: string | null;
}

export interface Mailer {
  /** Recorded alongside each send. "resend" | "log". */
  readonly name: string;
  /**
   * Send every message, resolving one result per message IN ORDER.
   *
   * Must not throw for a per-recipient failure — that belongs in `error` so the
   * caller can log who did and did not get mail. Throwing is reserved for a
   * request that failed as a whole (the network, a refused batch), which the
   * caller turns into a 502 without writing any log rows for it.
   */
  sendBatch(messages: Message[]): Promise<SendResult[]>;
}
