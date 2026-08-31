import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { getMailer, type Mailer, type Message } from "../mail";
import { reminderBody, reminderSubject, type ReminderKind } from "./reminders";

/**
 * The send itself — the reminder job, minus its transport.
 *
 * Given a SERVICE-ROLE client it:
 *   1. Asks Postgres who is due (`reminder_due`, migration 0015), which is the
 *      only place an email address is resolved.
 *   2. Narrows that to the admin's ticked selection — never widens it.
 *   3. Renders one message per recipient from the same pure functions the
 *      drawer's preview uses.
 *   4. Sends in chunks and writes a log row per recipient after each chunk.
 *
 * It lives here rather than in a Netlify function because it is built to have
 * two callers: the admin's "Send" button today, by way of the `sendReminders`
 * server action, and a scheduled function later. Keeping one body is what stops
 * those drifting — a cron that sent differently from the button would be worse
 * than no cron. It must ALSO not live in netlify/functions: Netlify deploys
 * every file in that directory as a function and derives the name from the
 * filename (see netlify/function-names.test.ts).
 *
 * Requires the service role. `reminder_due` and `record_reminder_send` are both
 * granted to `service_role` alone, and `reminder_due` reads auth.users.
 */
export interface ReminderOutcome {
  /** The JSON verdict. A future cron logs and returns it; the action reads it. */
  body: Record<string, unknown>;
  httpStatus: number;
}

interface DueRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  last_sent_at: string | null;
}

export interface ReminderRunOptions {
  groupId: string;
  kind: ReminderKind;
  season: number;
  seasonType?: string;
  /** The reminder week for a pick; null for a buy-in. Derived by the caller. */
  week: number | null;
  /**
   * The admin's ticked selection. An EMPTY array means "everyone due" — the
   * caller passes ids only to narrow.
   */
  userIds?: string[];
  leagueName: string;
  buyInCents: number;
  /** The week's last kickoff, for the deadline line. */
  deadlineIso: string | null;
  partiallyStarted: boolean;
  /** Absolute, resolved server-side. Never taken from the browser. */
  appUrl: string;
  /** The admin who pressed Send — named in the buy-in copy. */
  commissionerFirstName?: string;
  commissionerEmail?: string;
  commissionerPhone?: string | null;
  now: Date;
  mailer?: Mailer;
  /** Resolve recipients and render, but send nothing and write nothing. */
  dryRun?: boolean;
  /** Stop starting new chunks past this. Default 8000, load-schedule's number. */
  budgetMs?: number;
}

export async function runReminderSend(
  supabase: SupabaseClient<Database>,
  opts: ReminderRunOptions,
): Promise<ReminderOutcome> {
  const {
    groupId,
    kind,
    season,
    seasonType = "regular",
    week,
    userIds = [],
    leagueName,
    buyInCents,
    deadlineIso,
    partiallyStarted,
    appUrl,
    now,
    commissionerFirstName,
    commissionerEmail,
    commissionerPhone,
    dryRun = false,
    budgetMs = 8000,
  } = opts;

  const startedAt = now.getTime();
  const runId = globalThis.crypto.randomUUID();
  const mailer = opts.mailer ?? getMailer();

  if (!mailer) {
    return {
      body: { ok: false, detail: "mail-unconfigured", sent: 0 },
      httpStatus: 500,
    };
  }

  // A pick reminder without a week has nothing to talk about. Guarded here as
  // well as in the action because this function is the one a future cron calls.
  if (kind === "pick" && week === null) {
    return { body: { ok: true, detail: "no-week", sent: 0 }, httpStatus: 200 };
  }

  const { data, error } = await supabase.rpc("reminder_due", {
    p_group_id: groupId,
    p_kind: kind,
    p_season: season,
    p_season_type: seasonType,
    p_week: week,
  });

  if (error) {
    console.error("[reminders] reminder_due failed", error);
    return {
      body: { ok: false, detail: "due-read", error: error.message, sent: 0 },
      httpStatus: 500,
    };
  }

  const due = (data ?? []) as unknown as DueRow[];

  /*
   * The tickboxes NARROW and can never widen.
   *
   * `reminder_due` is the authoritative set; `userIds` only ever filters it.
   * That is what keeps per-recipient selection from becoming an open relay: a
   * server action is a reachable HTTP endpoint, so a hand-rolled POST naming
   * arbitrary ids still cannot reach anyone the database did not already say
   * was due — and it never names an address at all, because addresses do not
   * leave this function.
   *
   * It is also the guard against a stale tab. Someone who submitted their pick
   * after the panel was drawn has already dropped off `reminder_due`, so their
   * id in this list matches nothing.
   */
  const selected = userIds.length > 0 ? due.filter((r) => userIds.includes(r.user_id)) : due;

  const recipients = selected.filter((r) => typeof r.email === "string" && r.email.length > 0);

  if (recipients.length === 0) {
    return {
      body: { ok: true, detail: "nobody-due", sent: 0, due: due.length },
      httpStatus: 200,
    };
  }

  const messages: Message[] = recipients.map((r) => {
    const input = {
      kind,
      firstName: (r.first_name ?? "").trim(),
      leagueName,
      week,
      deadlineIso,
      partiallyStarted,
      buyInCents,
      url: `${appUrl}${kind === "pick" ? "/app" : "/app/account"}`,
      commissionerFirstName,
      commissionerEmail,
      commissionerPhone,
    };
    const { text, html } = reminderBody(input);
    return { to: r.email as string, subject: reminderSubject(input), text, html };
  });

  if (dryRun) {
    // Render and report, write NOTHING. Writing the log on a dry run would burn
    // the idempotence keys and silently suppress the real send afterwards —
    // the opposite of what `load-schedule --dry` promises.
    await mailer.sendBatch(messages);
    return {
      body: {
        ok: true,
        detail: "dry-run",
        sent: 0,
        wouldSend: recipients.length,
        provider: mailer.name,
      },
      httpStatus: 200,
    };
  }

  /*
   * Chunked, with the log written after each chunk rather than at the end.
   *
   * load-schedule's "write each week as it lands", and the payoff is sharper
   * here: if the budget runs out or the process dies, the recipients already
   * mailed are already recorded, so the retry skips them. The alternative —
   * one write at the end — turns any interruption into a second email for
   * everyone who had already received the first.
   */
  const CHUNK = 100;
  let sent = 0;
  let failed = 0;
  let stoppedEarly = false;

  for (let i = 0; i < messages.length; i += CHUNK) {
    if (Date.now() - startedAt > budgetMs) {
      stoppedEarly = true;
      break;
    }

    const chunk = messages.slice(i, i + CHUNK);
    const people = recipients.slice(i, i + CHUNK);

    let results;
    try {
      results = await mailer.sendBatch(chunk);
    } catch (err) {
      // The provider refused the chunk as a whole, so NOTHING was sent for it.
      // Write no rows: a row here would suppress the retry for people who never
      // got an email. Earlier chunks keep their rows and their count.
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[reminders] batch send failed", detail);
      return {
        body: {
          ok: false,
          detail: "provider",
          error: detail,
          sent,
          failed,
          remaining: messages.length - i,
          runId,
        },
        httpStatus: 502,
      };
    }

    for (let j = 0; j < people.length; j += 1) {
      const person = people[j];
      const result = results[j];
      if (!person) continue;
      const ok = !result || result.error === null;
      if (ok) sent += 1;
      else failed += 1;

      // Recorded per recipient even though the request was a batch, because
      // "who has been emailed" is exactly what the unique index encodes. The
      // write can never fail the run, for record_feed_sync's reason: a missing
      // table costs observability and a duplicate email, never the send itself.
      try {
        const { error: writeErr } = await supabase.rpc("record_reminder_send", {
          p_run_id: runId,
          p_group_id: groupId,
          p_user_id: person.user_id,
          p_kind: kind,
          p_season: season,
          p_season_type: seasonType,
          p_week: kind === "pick" ? week : null,
          p_status: ok ? "sent" : "failed",
          p_provider_id: result?.providerId ?? null,
          p_error: result?.error ?? null,
        });
        if (writeErr) console.error("[reminders] send log write failed", writeErr);
      } catch (err) {
        console.error("[reminders] send log write threw", err);
      }
    }
  }

  return {
    body: {
      ok: true,
      detail: stoppedEarly ? "stopped-early" : `sent-${sent}-of-${messages.length}`,
      sent,
      failed,
      provider: mailer.name,
      runId,
    },
    httpStatus: stoppedEarly ? 206 : 200,
  };
}
