/**
 * Season phase + current-week resolution.
 *
 * The rest of the app had no notion of "before the season starts" — the current
 * week was a hardcoded constant. This module derives, from the clock and the
 * league's entry deadline, which phase the season is in and which week is live.
 * Pure (every "now" is passed in) so it is unit-tested and shared by the server,
 * the screens, and the scorer.
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
  const finalWeek = opts.finalWeek ?? 18;
  if (opts.phase === "preseason") return 1;

  const nowMs = opts.now.getTime();

  // Earliest kickoff per week.
  const firstKickoff = new Map<number, number>();
  for (const g of opts.games) {
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
