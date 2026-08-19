/*
 * Scheduled scorer — the heartbeat of the league.
 *
 * Runs on a cron during game windows and:
 *   1. Works out which weeks are actually in play, from the schedule already in
 *      Postgres and the clock.
 *   2. Polls the NFL provider (ESPN by default) for those weeks and upserts them —
 *      updating kickoff, status, and score. Because pick locks key off each game's
 *      kickoff, this is also what locks picks.
 *   3. Recomputes every affected member's result/strikes/elimination using the
 *      SAME pure engine the app and tests use (src/lib/game/elimination.ts), so
 *      standings reflect a Thursday-night loss on Thursday, not end-of-week.
 *
 * It used to poll exactly one week, read from `process.env.NFL_WEEK` and
 * defaulting to 1 — so it re-polled Week 1 forever and no other week ever got a
 * row. The week is now derived, and preseason is polled too while it is live.
 *
 * Writes use the Supabase service role, which bypasses RLS. No-ops cleanly when
 * Supabase isn't configured, so it's safe to deploy before secrets are set.
 *
 * Netlify v2 function: default export + `config.schedule`.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/types";
import { getNflProvider, nflProviderName } from "../../src/lib/providers";
import { recomputeSeason } from "../../src/lib/game/score";
import { pollTargets, upsertGames } from "../../src/lib/nfl/schedule";
import type { Game, SeasonType } from "../../src/lib/nfl/types";

export const config = {
  // Every 5 minutes. In production, narrow this to Thu/Sun/Mon game windows.
  schedule: "*/5 * * * *",
};

function json(body: unknown, status = 200): Response {
  /*
   * Log the verdict, don't just return it.
   *
   * A scheduled invocation has no caller: Netlify runs this on a cron and
   * discards the response body. So every outcome this function computes — the
   * `skipped` reasons, the failure stage, how many members were updated — was
   * being thrown away, and the function log showed nothing but a duration. The
   * league's heartbeat ran unattended and unobservable, and diagnosing it meant
   * reasoning backwards from how many milliseconds it took.
   *
   * Every return path goes through this helper, which is why the line lives
   * here rather than at each `return` — a new branch added later is logged
   * without anyone remembering to.
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json({ skipped: "supabase-not-configured" });

  const season = Number(process.env.NFL_SEASON ?? new Date().getUTCFullYear());
  const supabase = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });
  const now = new Date();

  /*
   * Record the verdict, then return it.
   *
   * Same argument the `json` helper above makes for logging — every return path
   * goes through one funnel, so a branch added later is recorded without anyone
   * remembering to — but this one reaches the database, which is what the admin
   * modal's Data Feed tab reads. Before this, the ONLY evidence a run had
   * happened was a function log nobody was looking at, and the tab showed a
   * hardcoded "ESPN · healthy" whether or not the scorer had run since August.
   *
   * The write MUST NOT be able to fail the run. A feed_status table that is
   * missing because 0011 has not been applied by hand yet (see CLAUDE.md —
   * nothing in this repo applies migrations) has to cost observability, never
   * scoring. Hence the try/catch and the deliberately discarded error.
   *
   * `checked_at` is stamped by Postgres inside the RPC, not from `now` here: the
   * read side returns the database's clock too, and the tab subtracts one from
   * the other to print "checked 3 minutes ago". Two machines' clocks are how
   * that goes negative.
   */
  async function finish(
    verdict: {
      status: "ok" | "error";
      detail: string;
      error?: string | null;
      gamesUpserted?: number;
      membersUpdated?: number;
    },
    body: Record<string, unknown>,
    httpStatus = 200,
  ): Promise<Response> {
    try {
      const { error } = await supabase.rpc("record_feed_sync", {
        p_status: verdict.status,
        p_detail: verdict.detail,
        p_provider: nflProviderName(),
        p_season: season,
        p_games_upserted: verdict.gamesUpserted ?? 0,
        p_members_updated: verdict.membersUpdated ?? 0,
        p_error: verdict.error ?? null,
      });
      if (error) console.error("[poll-scores] feed_status write failed", error);
    } catch (err) {
      console.error("[poll-scores] feed_status write threw", err);
    }
    return json(body, httpStatus);
  }

  // 1) Which weeks are live? Derived from the loaded schedule, not an env var.
  const { data: scheduleRows, error: scheduleErr } = await supabase
    .from("games")
    .select("season_type, week, kickoff")
    .eq("season", season);
  if (scheduleErr) {
    return finish(
      { status: "error", detail: "schedule-read", error: scheduleErr.message },
      { ok: false, stage: "schedule-read", error: scheduleErr.message },
      500,
    );
  }
  if (!scheduleRows || scheduleRows.length === 0) {
    // Nothing to poll and nothing to score. The schedule has to be loaded first —
    // see netlify/functions/load-schedule.ts.
    // Not an error: nothing has gone wrong, there is simply no schedule to poll
    // until load-schedule has run. Recorded as `ok` so the tab doesn't report a
    // healthy-but-unconfigured system as a failing feed.
    return finish(
      { status: "ok", detail: "no-schedule-loaded" },
      { skipped: "no-schedule-loaded", season },
    );
  }

  const targets = pollTargets(scheduleRows, now);

  // 2) Poll each target week and upsert. A failing week is reported, not fatal.
  const games: Game[] = [];
  const failures: { seasonType: SeasonType; week: number; error: string }[] = [];
  const provider = getNflProvider();
  for (const target of targets) {
    try {
      const fetched = await provider.getWeekGames({
        season,
        week: target.week,
        seasonType: target.seasonType,
      });
      games.push(...fetched);
    } catch (err) {
      failures.push({ ...target, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (games.length === 0) {
    // `pollTargets` always includes at least the current regular week, so this
    // is never "nothing to do" — it means the provider answered for no target at
    // all, which is a real failure.
    return finish(
      {
        status: "error",
        detail: "provider",
        error: failures[0]?.error ?? "no games returned",
      },
      { ok: false, stage: "provider", targets, failures, error: "no games returned" },
      502,
    );
  }

  const write = await upsertGames(supabase, games, { now });
  if (write.error) {
    return finish(
      { status: "error", detail: "games-upsert", error: write.error },
      { ok: false, stage: "games-upsert", error: write.error },
      500,
    );
  }

  // 3) Recompute eliminations (shared engine — see src/lib/game/score.ts).
  //    Regular season only: preseason is a practice round whose standing is
  //    derived at read time and must never touch group_members.
  const regularWeeks = targets.filter((t) => t.seasonType === "regular").map((t) => t.week);
  const throughWeek = regularWeeks.length > 0 ? Math.max(...regularWeeks) : 0;

  if (throughWeek === 0) {
    // Preseason only: games were polled and written, there is just no regular
    // season to score yet. A successful run.
    return finish(
      { status: "ok", detail: "preseason-only", gamesUpserted: write.upserted },
      { ok: true, targets, failures, gamesUpserted: write.upserted, membersUpdated: 0 },
    );
  }

  try {
    const result = await recomputeSeason(supabase, season, throughWeek, now);
    return finish(
      {
        status: "ok",
        detail: `scored-through-week-${throughWeek}`,
        gamesUpserted: write.upserted,
        membersUpdated: result.membersUpdated,
      },
      { ok: true, targets, failures, throughWeek, gamesUpserted: write.upserted, ...result },
    );
  } catch (err) {
    return finish(
      { status: "error", detail: "recompute", error: String(err) },
      { ok: false, stage: "recompute", error: String(err) },
      500,
    );
  }
}
