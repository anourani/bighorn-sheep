/**
 * Season phase + current-week resolution.
 *
 * The rest of the app had no notion of "before the season starts" — the current
 * week was a hardcoded constant. This module derives, from the clock and the
 * league's entry deadline, which phase the season is in and which week is live.
 * Pure (every "now" is passed in) so it is unit-tested and shared by the server,
 * the screens, and the scorer.
 */

import { FINAL_WEEK } from "../nfl/calendar";

/**
 * A league's phase relative to its own Week 1 kickoff.
 *
 * Careful with the word: "preseason" here means *before this league's Week 1
 * kickoff, entry still open*. It is NOT the NFL preseason and has no relationship
 * to `games.season_type = 'pre'`. A league is in phase "preseason" whether or not
 * any preseason football exists. The preseason-football feature is called
 * "practice" everywhere else in the codebase to keep the two apart.
 */
export type SeasonPhase = "preseason" | "regular" | "ended";

/**
 * Which phase a league is in.
 *  - "preseason": now is before the first Week 1 kickoff (entry still open).
 *  - "regular": the season is underway.
 *  - "ended": the season has resolved (a winner, a wipeout, or Week 18 closed).
 *    Callers derive `ended` from the engine's seasonState(); this module does not
 *    recompute it.
 *
 * `entryClosesAt` is, by the survival convention, the first kickoff of Week 1.
 */
export function seasonPhase(entryClosesAt: Date, now: Date, ended = false): SeasonPhase {
  if (ended) return "ended";
  return now.getTime() < entryClosesAt.getTime() ? "preseason" : "regular";
}

/** Convenience: is entry still open (i.e. we're in preseason)? */
export function isEntryOpen(entryClosesAt: Date, now: Date): boolean {
  return now.getTime() < entryClosesAt.getTime();
}

/**
 * The live week number.
 *  - Preseason → Week 1 (the first pickable week).
 *  - Regular   → the greatest week that has already begun (its earliest kickoff
 *                has passed); before any week has begun, Week 1. Capped at
 *                `finalWeek`.
 *
 * Games may be a partial schedule (any weeks, any order); only their week +
 * kickoff are read.
 */
export function resolveCurrentWeek(opts: {
  phase: SeasonPhase;
  now: Date;
  games: { week: number; kickoff: string }[];
  finalWeek?: number;
}): number {
  if (opts.phase === "preseason") return 1;
  return resolveWeekFromKickoffs(opts.games, opts.now, opts.finalWeek ?? FINAL_WEEK);
}

/**
 * The greatest week whose earliest kickoff has already passed; 1 before any week
 * has begun. Capped at `finalWeek`.
 *
 * Split out of `resolveCurrentWeek` so the NFL-preseason practice round can reuse
 * it against its own slice of the schedule (with `finalWeek` = the last preseason
 * week). It carries no notion of phase, which is the point: callers hand it games
 * that are already filtered to one `season_type`.
 *
 * IMPORTANT: never pass a mixed-season_type list. Preseason week 3 and regular
 * week 3 are indistinguishable here, so an August preseason kickoff would report
 * the regular season as being in week 3.
 */
export function resolveWeekFromKickoffs(
  games: { week: number; kickoff: string }[],
  now: Date,
  finalWeek: number = FINAL_WEEK,
): number {
  const nowMs = now.getTime();

  // Earliest kickoff per week.
  const firstKickoff = new Map<number, number>();
  for (const g of games) {
    const k = new Date(g.kickoff).getTime();
    const prev = firstKickoff.get(g.week);
    if (prev === undefined || k < prev) firstKickoff.set(g.week, k);
  }

  let current = 1;
  for (const [week, kickoff] of firstKickoff) {
    if (kickoff <= nowMs && week > current) current = week;
  }
  return Math.min(current, finalWeek);
}

/** Why a client-supplied pick week was refused. */
export type PickWeekRejection = "bad_week" | "week_already_started";

/**
 * Which week a pick is FOR, once the client is allowed to say.
 *
 * `submitPick` used to derive the week and ignore the caller entirely, which was
 * the whole enforcement behind "you can only pick for the live week". Picking
 * ahead means the caller now names a week — and a Server Action is a reachable
 * HTTP endpoint, so this is the gate, not the greyed-out UI.
 *
 * Three refusals, deliberately not one:
 *
 * - A `requested` that is absent falls back to `liveWeek`. That is not laxity:
 *   a tab loaded before this shipped sends no week at all, and answering it with
 *   `bad_week` would break picking for everyone mid-deploy.
 * - Outside `weeks` is `bad_week`. Callers pass the AUTHORITATIVE set — the
 *   practice slate's own weeks, not a numeric range — so a four-week preseason
 *   request against a three-week slate is refused here rather than surfacing
 *   later as the much vaguer `no_game_for_team`.
 * - Before `liveWeek` is `week_already_started`, and it is worth keeping even
 *   though `canPick`'s `game_kicked_off` and RLS 0014's `g.kickoff > now()`
 *   both catch the ordinary case. A POSTPONED game keeps its original `week`
 *   with a kickoff in the future, so a pick for that week would slip past both;
 *   and "that week has already started" is a true sentence where "that game has
 *   kicked off" is a confusing one.
 *
 * Pure, because `actions.ts` is `"use server"` over a Supabase client and cannot
 * be unit-tested. This is where the paranoia goes so it can be.
 */
export function resolvePickWeek(input: {
  /** Omitted by a tab from before picking ahead shipped. */
  requested: number | undefined;
  liveWeek: number;
  /** Every week this phase actually has. */
  weeks: readonly number[];
}): { ok: true; week: number } | { ok: false; error: PickWeekRejection } {
  const week = input.requested ?? input.liveWeek;
  // `Number.isInteger` and not a `typeof` test: it rejects NaN, Infinity, 1.5
  // and the string "3" in one predicate, and every one of those can arrive on a
  // hand-rolled POST.
  if (!Number.isInteger(week)) return { ok: false, error: "bad_week" };
  if (!input.weeks.includes(week)) return { ok: false, error: "bad_week" };
  if (week < input.liveWeek) return { ok: false, error: "week_already_started" };
  return { ok: true, week };
}
