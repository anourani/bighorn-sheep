import { isKickedOff, type Game, type TeamId } from "../nfl/types";
import { countStrikes, evaluateWeek } from "../game/elimination";
import { buildGameIndex, type GameIndex } from "./games";
import type { CurrentPick, GroupRules, HistoryPick, PickResult } from "./types";

/**
 * The preseason practice round.
 *
 * NOTHING HERE ELIMINATES ANYONE. Preseason is a rehearsal: a losing pick is
 * counted and shown, so the table means something and you can see how you would
 * have fared, but only the regular season ends a run. That is why this file
 * reaches for `countStrikes` rather than the `computeStatus` fold the real season
 * uses — see the note on it in `../game/elimination.ts`.
 *
 * It used to work the other way, and the cost was concrete: one losing preseason
 * pick in a single-elimination league derived `eliminated`, and `submitPick`'s
 * guard then refused every remaining practice pick with "You're eliminated, so
 * picks are closed." Since the pick surfaces never read status at all, the tap
 * painted optimistically and then snapped back to "No Pick Made" — the practice
 * round shutting itself down for exactly the people using it.
 *
 * Everything else about the round is still thrown away completely at Week 1:
 * strikes and used teams reset, and preseason stops appearing in the standings.
 *
 * The way that reset is implemented is by NOT STORING ANY OF IT.
 * `group_members.status` / `.strikes` / `.eliminated_week` remain exclusively
 * regular-season, written only by `recomputeSeason` (which filters to
 * `season_type = 'regular'`). Practice standing is derived here, from preseason
 * picks and preseason games, every time it is read. So the "reset" is not a job
 * that runs at Week 1 — it is the loader simply ceasing to build this object once
 * `now >= entryClosesAt`. Nothing mutates, nothing can half-fail, and the
 * preseason picks stay in the database as history.
 *
 * Pure: `now` is always passed in, no Supabase import, so it unit-tests and runs
 * on both sides of the RSC boundary.
 */

/** The minimum a pick row needs to expose to be folded into practice standing. */
export interface PracticePickInput {
  userId: string;
  week: number;
  teamId: TeamId;
  gameId: string;
}

export interface PracticeMember {
  id: string;
  /**
   * Practice losses only. Never mixed with the member's real strikes, and never
   * capped: nothing eliminates in practice, so this keeps counting past the
   * group's strike allowance.
   *
   * There is deliberately no `status` or `eliminatedWeek` beside it. Pinning them
   * to "alive"/null would be a field that can only ever hold one value — a claim
   * waiting to be read as a real one — so the fact that practice cannot eliminate
   * is expressed by the absence, and the two consumers supply the constants.
   */
  strikes: number;
  history: HistoryPick[];
  currentPick: CurrentPick | null;
  /**
   * EVERY practice pick, resolved or not. `history` only carries picks whose game
   * has produced a result, so it is the wrong basis for a used-team list: a pick on
   * a game that hasn't gone final yet is absolutely still spent. Basing the guard on
   * `history` let the UI re-offer a team the database would then reject with a
   * unique violation.
   */
  picks: { week: number; teamId: TeamId }[];
  /** False when this member has not joined the practice round at all. */
  participating: boolean;
}

export interface PracticeState {
  /** Preseason games only, ascending by kickoff. */
  games: Game[];
  /** Preseason week numbers that have a schedule, ascending. */
  weeks: number[];
  /** Highest preseason week present — drives Hall of Fame vs Preseason labelling. */
  maxPreWeek: number;
  /** The live preseason week (greatest whose first kickoff has passed). */
  currentWeek: number;
  /** Derived standing per member id. */
  members: Record<string, PracticeMember>;
}

export interface DerivePracticeInput {
  /** MUST already be filtered to `season_type = 'pre'`. */
  games: Game[];
  /** MUST already be filtered to `season_type = 'pre'`. */
  picks: PracticePickInput[];
  memberIds: string[];
  rules: GroupRules;
  now: Date;
}

/**
 * Build the practice bundle, or null when there is no preseason schedule to
 * practise against.
 *
 * Callers are responsible for the other half of the reset: only call this while
 * the league is still in phase "preseason" (`now < group.entryClosesAt`). Once
 * the real season starts, pass nothing to the UI.
 */
export function derivePractice(input: DerivePracticeInput): PracticeState | null {
  const games = [...input.games].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  if (games.length === 0) return null;

  const idx = buildGameIndex(games);
  const weeks = idx.weeksWithGames;
  const maxPreWeek = weeks[weeks.length - 1] ?? 0;
  const currentWeek = livePracticeWeek(games, weeks, input.now);

  const picksByUser = new Map<string, PracticePickInput[]>();
  for (const p of input.picks) {
    const arr = picksByUser.get(p.userId) ?? [];
    arr.push(p);
    picksByUser.set(p.userId, arr);
  }

  const members: Record<string, PracticeMember> = {};
  for (const id of input.memberIds) {
    members[id] = derivePracticeMember({
      picks: picksByUser.get(id) ?? [],
      idx,
      // Only weeks that have begun can damage anyone; a future week's missed pick
      // is "no_pick", which isDamaging treats as harmless.
      weeks: weeks.filter((w) => w <= currentWeek),
      currentWeek,
      rules: input.rules,
      now: input.now,
      id,
    });
  }

  return { games, weeks, maxPreWeek, currentWeek, members };
}

/**
 * The week you can practise on: the earliest preseason week that still has a game
 * yet to kick off. Once every preseason game has started, the last week (so results
 * stay on screen until the reset).
 *
 * Deliberately NOT `resolveWeekFromKickoffs`, which answers "greatest week already
 * begun" — the right question for the regular season, where the week you are in is
 * the week being played. Preseason weeks are one to sixteen games and a week can be
 * completely over within hours: the Hall of Fame game is a single fixture in early
 * August, so "greatest week begun" pointed at a finished week for the entire run-up
 * to preseason week 2, leaving nothing pickable and the practice round dead on
 * arrival.
 */
function livePracticeWeek(games: Game[], weeks: number[], now: Date): number {
  for (const week of weeks) {
    const open = games.some((g) => g.week === week && !isKickedOff(g, now));
    if (open) return week;
  }
  return weeks[weeks.length - 1] ?? 1;
}

function derivePracticeMember(args: {
  id: string;
  picks: PracticePickInput[];
  idx: GameIndex;
  weeks: number[];
  currentWeek: number;
  rules: GroupRules;
  now: Date;
}): PracticeMember {
  const { id, picks, idx, weeks, currentWeek, rules, now } = args;

  const results: PickResult[] = [];
  const history: HistoryPick[] = [];
  let currentPick: CurrentPick | null = null;

  /*
   * Your practice run starts at your first practice pick.
   *
   * Preseason has no entry deadline — the regular season's `entry_closes_at` gate
   * is what stops someone joining a league mid-run, and there is no equivalent for
   * practice. So folding EVERY preseason week would retroactively charge a member
   * for weeks that finished before they ever opened the app: the Hall of Fame game
   * is played in early August, so by preseason week 2 a brand-new account would
   * arrive already carrying losses it had no way to avoid.
   *
   * That used to be the difference between a usable practice round and a dead one,
   * because those phantom losses eliminated you. Nothing eliminates here now, so
   * the stake is smaller — but a practice record is still a claim about what you
   * did, and weeks you were never present for are not part of it.
   *
   * Weeks before a member's first pick are therefore skipped, not forgiven: once
   * you are in, a missed week is a loss like anywhere else.
   */
  const firstPickWeek = picks.reduce<number | null>(
    (min, p) => (min === null || p.week < min ? p.week : min),
    null,
  );
  const participating = firstPickWeek !== null;
  const scoredWeeks = participating ? weeks.filter((w) => w >= firstPickWeek) : [];

  for (const week of scoredWeeks) {
    const pick = picks.find((p) => p.week === week) ?? null;
    const game = pick ? (idx.gameById(pick.gameId) ?? null) : null;
    const finalKickoff = idx.weekFinalKickoff(week);

    const result = evaluateWeek({
      teamId: pick?.teamId ?? null,
      game,
      // No schedule for the week ⇒ its deadline is unreachable, so a missing pick
      // cannot yet count as a loss. Same sentinel recomputeSeason uses.
      weekFinalKickoff: finalKickoff ?? new Date(8640000000000000),
      rules,
      now,
    });

    results.push(result);

    if (pick && week < currentWeek && (result === "win" || result === "loss" || result === "push")) {
      history.push({ week, teamId: pick.teamId, result });
    }
  }

  const current = picks.find((p) => p.week === currentWeek) ?? null;
  if (current) {
    currentPick = { week: current.week, teamId: current.teamId, gameId: current.gameId };
  }

  return {
    id,
    strikes: countStrikes(results),
    history,
    currentPick,
    picks: picks.map((p) => ({ week: p.week, teamId: p.teamId })),
    participating,
  };
}

/**
 * The used-team list for the practice round: every team this member has picked in
 * preseason, resolved or not.
 *
 * Built from `picks`, NOT `history` — an unresolved pick still spends its team, and
 * with no scorer running nothing ever resolves, so a history-based list re-offered
 * teams the database would reject.
 *
 * Deliberately separate from the regular-season history, which is what makes a team
 * practised in preseason available again at Week 1. The database enforces the same
 * split via `unique (group_id, user_id, season_type, team_id)` (0006).
 */
export function practiceUsedTeams(
  member: PracticeMember | undefined,
  opts: { excludeWeek?: number } = {},
): { teamId: TeamId }[] {
  if (!member) return [];
  return member.picks
    .filter((p) => p.week !== opts.excludeWeek)
    .map((p) => ({ teamId: p.teamId }));
}
