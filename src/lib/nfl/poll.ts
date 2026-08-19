import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { getNflProvider, nflProviderName } from "../providers";
import { recomputeSeason } from "../game/score";
import { pollTargets, upsertGames } from "./schedule";
import type { Game, SeasonType } from "./types";

/**
 * The scorer itself — the heartbeat of the league, minus its transport.
 *
 * Given a service-role client it:
 *   1. Works out which weeks are actually in play, from the schedule already in
 *      Postgres and the clock.
 *   2. Polls the NFL provider (ESPN by default) for those weeks and upserts them —
 *      updating kickoff, status, and score. Because pick locks key off each game's
 *      kickoff, this is also what locks picks.
 *   3. Recomputes every affected member's result/strikes/elimination using the
 *      SAME pure engine the app and tests use (src/lib/game/elimination.ts), so
 *      standings reflect a Thursday-night loss on Thursday, not end-of-week.
 *   4. Records the verdict to `feed_status`, which is what the admin drawer's
 *      Data Feed tab reads.
 *
 * It lives here rather than in netlify/functions/poll-scores.ts because it now
 * has two callers: the five-minute scheduled function, and the admin's "Check now"
 * button by way of the `runFeedCheck` server action. Keeping one body is what
 * stops those two drifting — a manual check that polled differently from the
 * cron would be worse than no manual check at all.
 *
 * It must also NOT live in netlify/functions: Netlify deploys every file in that
 * directory as a function and derives the name from the filename, so a module
 * beside the handlers is a deploy hazard (see netlify/function-names.test.ts).
 *
 * Requires the service role. `record_feed_sync` is granted to `service_role`
 * alone (migration 0011), and both `upsertGames` and `recomputeSeason` write
 * tables no player policy allows.
 */
export interface PollOutcome {
  /** The JSON verdict. The scheduled function logs and returns it; the action ignores it. */
  body: Record<string, unknown>;
  httpStatus: number;
}

type Verdict = {
  status: "ok" | "error";
  detail: string;
  error?: string | null;
  gamesUpserted?: number;
  membersUpdated?: number;
};

export async function runScorePoll(
  supabase: SupabaseClient<Database>,
  opts: { season: number; now: Date },
): Promise<PollOutcome> {
  const { season, now } = opts;

  /*
   * Record the verdict, then return it.
   *
   * Every return path goes through one funnel, so a branch added later is
   * recorded without anyone remembering to. Before this, the ONLY evidence a run
   * had happened was a function log nobody was looking at, and the Data Feed tab
   * showed a hardcoded "ESPN · healthy" whether or not the scorer had run since
   * August.
   *
   * The write MUST NOT be able to fail the run. A feed_status table that is
   * missing because 0011 has not been applied by hand yet (see CLAUDE.md —
   * nothing in this repo applies migrations) has to cost observability, never
   * scoring. Hence the try/catch and the deliberately discarded error.
   *
   * It is also what makes a FAILED manual check useful: the caller can re-read
   * feed_status and show the admin what the run actually hit, rather than a bare
   * "something went wrong".
   *
   * `checked_at` is stamped by Postgres inside the RPC, not from `now` here: the
   * read side returns the database's clock too, and the tab subtracts one from
   * the other to print "checked 3 minutes ago". Two machines' clocks are how
   * that goes negative.
   */
  async function finish(
    verdict: Verdict,
    body: Record<string, unknown>,
    httpStatus = 200,
  ): Promise<PollOutcome> {
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
    return { body, httpStatus };
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
