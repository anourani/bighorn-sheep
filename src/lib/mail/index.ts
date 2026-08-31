import { LogMailer, ResendMailer } from "./resend";
import type { Mailer } from "./types";

export type { Mailer, Message, SendResult } from "./types";
export { LogMailer, ResendMailer, RESEND_MAX_BATCH } from "./resend";

/** The default sender. Overridable so a fork does not have to edit code. */
const DEFAULT_FROM = "Sheep with Glasses <noreply@sheepwithglasses.com>";

/**
 * The single place the app obtains a mailer — `getNflProvider`'s analogue.
 *
 * Returns NULL rather than throwing when `RESEND_API_KEY` is absent, which is
 * `serviceClient()`'s idiom and for its reason: the caller can then say
 * something true ("email isn't configured on this deployment") instead of
 * surfacing an opaque exception in a Server Action.
 *
 * `REMINDER_DRY_RUN=1` forces `LogMailer` even when a key is present. That is
 * the switch `docs/dry-run.md` documents for exercising the whole path without
 * mailing the league.
 *
 * SERVER ONLY. `RESEND_API_KEY` is deliberately not `NEXT_PUBLIC_`, so this
 * resolves to null in any browser bundle it is imported into — which would be a
 * bug, not a feature. Do not import this from a "use client" file.
 *
 * The key here is NOT the one Supabase uses to send magic links. That one lives
 * in Supabase's own SMTP settings, which nothing in this repo can read, and
 * keeping them separate means rotating one cannot break sign-in. Note that a
 * Resend key is scoped to a single domain: one issued for another project
 * answers "API key not authorized for this domain", which is exactly how the
 * sign-in domain cutover broke once already. Read Resend → Logs before
 * theorising — it distinguishes SMTP requests from API ones.
 */
export function getMailer(): Mailer | null {
  if (process.env.REMINDER_DRY_RUN === "1") return new LogMailer();

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  return new ResendMailer({
    apiKey,
    from: process.env.REMINDER_FROM || DEFAULT_FROM,
  });
}

/** Which mailer `getMailer()` will build, as a bare string, for logging. */
export function mailerName(): string {
  if (process.env.REMINDER_DRY_RUN === "1") return "log";
  return process.env.RESEND_API_KEY ? "resend" : "none";
}
