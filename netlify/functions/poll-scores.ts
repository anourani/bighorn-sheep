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
import { getNflProvider } from "../../src/lib/providers";
import { recomputeSeason } from "../../src/lib/game/score";
import { resolveWeekFromKickoffs } from "../../src/lib/game/season";
import { upsertGames } from "../../src/lib/nfl/schedule";
import { FINAL_WEEK } from "../../src/lib/nfl/calendar";
import type { Game, SeasonType } from "../../src/lib/nfl/types";

export const config = {
  // Every 5 minutes. In production, narrow this to Thu/Sun/Mon game windows.
  schedule: "*/5 * * * *",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface WeekTarget {
  seasonType: SeasonType;
  week: number;
}

/**
 * Which weeks to poll right now.
 *
 * Regular season: the live week plus the one before it. The previous week matters
 * because a Monday-night game finishes after the next week's Thursday opener has
 * already moved `currentWeek` forward — poll only the live week and that final
 * score never lands, leaving a member's result permanently "pending".
 *
 * Preseason: polled only while the regular season hasn't started, and all of its
 * weeks at once. There are at most four and they are the whole practice round.
 */
export function pollTargets(
  rows: { season_type: SeasonType; week: number; kickoff: string }[],
  now: Date,
): WeekTarget[] {
  const regular = rows.filter((r) => r.season_type === "regular");
  const pre = rows.filter((r) => r.season_type === "pre");

  const firstRegularKickoff = regular.reduce<string | null>(
    (min, r) => (min === null || r.kickoff < min ? r.kickoff : min),
    null,
  );
  const regularStarted =
    firstRegularKickoff !== null && new Date(firstRegularKickoff).getTime() <= now.getTime();

  const targets: WeekTarget[] = [];

  if (!regularStarted && pre.length > 0) {
    const weeks = [...new Set(pre.map((r) => r.week))].sort((a, b) => a - b);
    for (const week of weeks) targets.push({ seasonType: "pre", week });
  }

  const currentWeek = resolveWeekFromKickoffs(regular, now, FINAL_WEEK);
  if (currentWeek > 1) targets.push({ seasonType: "regular", week: currentWeek - 1 });
  targets.push({ seasonType: "regular", week: currentWeek });

  return targets;
}

/*
 * Not secret-gated, and that is a considered choice rather than an oversight.
 * Netlify's scheduled invocations cannot send a custom header, so a secret check
 * here would either break the cron or have to be waived on a client-supplied
 * `user-agent` — which anyone can forge, making it theatre. See src/lib/cron-auth.ts.
 *
 * What makes that acceptable is idempotency: this reads ESPN and recomputes
 * standings from real results, so an unwanted trigger costs function minutes and
 * nothing else. `load-schedule`, which is expensive and on-demand, does require the
 * secret.
 */
export default async function handler(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json({ skipped: "supabase-not-configured" });

  const season = Number(process.env.NFL_SEASON ?? new Date().getUTCFullYear());
  const supabase = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });
  const now = new Date();

  // 1) Which weeks are live? Derived from the loaded schedule, not an env var.
  const { data: scheduleRows, error: scheduleErr } = await supabase
    .from("games")
    .select("season_type, week, kickoff")
    .eq("season", season);
  if (scheduleErr) {
    return json({ ok: false, stage: "schedule-read", error: scheduleErr.message }, 500);
  }
  if (!scheduleRows || scheduleRows.length === 0) {
    // Nothing to poll and nothing to score. The schedule has to be loaded first —
    // see netlify/functions/load-schedule.ts.
    return json({ skipped: "no-schedule-loaded", season });
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
    return json(
      { ok: false, stage: "provider", targets, failures, error: "no games returned" },
      502,
    );
  }

  const write = await upsertGames(supabase, games, { now });
  if (write.error) {
    return json({ ok: false, stage: "games-upsert", error: write.error }, 500);
  }

  // 3) Recompute eliminations (shared engine — see src/lib/game/score.ts).
  //    Regular season only: preseason is a practice round whose standing is
  //    derived at read time and must never touch group_members.
  const regularWeeks = targets.filter((t) => t.seasonType === "regular").map((t) => t.week);
  const throughWeek = regularWeeks.length > 0 ? Math.max(...regularWeeks) : 0;

  if (throughWeek === 0) {
    return json({ ok: true, targets, failures, gamesUpserted: write.upserted, membersUpdated: 0 });
  }

  try {
    const result = await recomputeSeason(supabase, season, throughWeek, now);
    return json({
      ok: true,
      targets,
      failures,
      throughWeek,
      gamesUpserted: write.upserted,
      ...result,
    });
  } catch (err) {
    return json({ ok: false, stage: "recompute", error: String(err) }, 500);
  }
}
