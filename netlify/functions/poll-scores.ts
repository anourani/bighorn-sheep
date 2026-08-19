/*
 * Scheduled scorer — the transport around src/lib/nfl/poll.ts.
 *
 * The work itself (derive the live weeks, poll the provider, upsert, recompute
 * eliminations, record the verdict to feed_status) lives in `runScorePoll`,
 * because it now has two callers: this cron, and the admin drawer's "Check now"
 * button by way of the `runFeedCheck` server action. One body, so a manual check
 * cannot drift from the scheduled one.
 *
 * What is left here is everything that is genuinely about being a Netlify
 * function: the schedule, the service-role client, the log line, and the
 * Response.
 *
 * Writes use the Supabase service role, which bypasses RLS. No-ops cleanly when
 * Supabase isn't configured, so it's safe to deploy before secrets are set.
 *
 * Netlify v2 function: default export + `config.schedule`.
 */
import { runScorePoll } from "../../src/lib/nfl/poll";
import { serviceClient } from "../../src/lib/supabase/service";

export const config = {
  // Every 5 minutes. In production, narrow this to Thu/Sun/Mon game windows.
  schedule: "*/5 * * * *",
};

function json(body: unknown, status = 200): Response {
  /*
   * Log the verdict, don't just return it.
   *
   * A scheduled invocation has no caller: Netlify runs this on a cron and
   * discards the response body. So every outcome the poll computes — the
   * `skipped` reasons, the failure stage, how many members were updated — was
   * being thrown away, and the function log showed nothing but a duration. The
   * league's heartbeat ran unattended and unobservable, and diagnosing it meant
   * reasoning backwards from how many milliseconds it took.
   *
   * Safe to log: the body carries week targets, counts and provider/Postgres
   * error strings. Neither key is ever in it.
   */
  console.log(`[poll-scores] ${status} ${JSON.stringify(body)}`);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(): Promise<Response> {
  const supabase = serviceClient();
  if (!supabase) return json({ skipped: "supabase-not-configured" });

  const season = Number(process.env.NFL_SEASON ?? new Date().getUTCFullYear());
  const outcome = await runScorePoll(supabase, { season, now: new Date() });
  return json(outcome.body, outcome.httpStatus);
}
