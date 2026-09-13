import type { Member } from "./types";
import type { TeamId } from "../nfl/types";

/**
 * The rules behind the admin Control Center's Picks tab (migration 0019).
 *
 * A PURE module for this repo's usual reason: vitest runs in the Node
 * environment here with no jsdom and no `vitest.config.ts`, so nothing renders
 * under test and anything that could be wrong has to be expressible as a
 * function. Same split as `writability.ts`, `standings-grid.ts` and
 * `headcount-grid.ts`.
 *
 * Relative imports, never `@/`: with no vitest config, tsconfig's `paths` are
 * never read, so a `@/` VALUE import resolves under Next and fails under vitest.
 * The type-only ones here would survive either way; the rule is the file's.
 *
 * WHAT THIS MODULE IS NOT. It is not an authority on whether a write will
 * succeed — `admin_set_pick` is, and it re-derives every gate below in SQL off
 * the database's own clock. What lives here is what the UI needs in order not to
 * OFFER something the RPC will refuse, which is the repo's standing rule about
 * a button and the function behind it.
 */

/** A game, narrowed to what this module reads. */
export interface AdminPickGame {
  week: number;
  kickoff: string;
  home: TeamId;
  away: TeamId;
}

/**
 * Everything the Picks tab needs, folded server-side.
 *
 * Narrowed rather than handing the tab `LeagueData.games` whole: that is ~272
 * rows, and the account page would carry them in its RSC payload on every admin
 * render for a tab most admins open rarely. This is a couple of kilobytes.
 */
export interface AdminPickData {
  /** Regular-season weeks whose FIRST kickoff has passed, ascending. */
  startedWeeks: number[];
  currentWeek: number;
  /** The teams playing, per started week. A team on a bye is simply absent. */
  teamsByWeek: Record<number, TeamId[]>;
  /** `group_members.id` with a pick this week whose game has NOT kicked off. */
  hiddenPickMemberIds: string[];
}

/**
 * Regular-season weeks whose EARLIEST kickoff has already passed.
 *
 * DERIVED FROM KICKOFFS, never from `resolveCurrentWeek`, and that is the single
 * most likely regression in this feature. `resolveCurrentWeek` answers 1 during
 * the preseason — by design, so the pick screen has a week to draw — so a
 * `1..currentWeek` range would offer Week 1 as editable all summer, months
 * before a ball is thrown. Reading the kickoffs answers `[]` in the preseason by
 * construction rather than by a phase test somebody has to remember.
 *
 * The earliest kickoff, not the latest, and it matches `admin_set_pick`'s own
 * gate: a week that began on Thursday is a week an admin may repair on Sunday,
 * even though its 4pm games have not started. Per-row safety is
 * `viewPickForWeek`'s job, one level down.
 *
 * A postponed game keeps its week and gains a future kickoff, so it can never
 * pull a started week back out of this list — `min` is already past.
 */
export function startedWeeks(
  games: readonly { week: number; kickoff: string }[],
  now: Date,
): number[] {
  const nowMs = now.getTime();
  const firstKickoff = new Map<number, number>();
  for (const g of games) {
    const k = new Date(g.kickoff).getTime();
    const prev = firstKickoff.get(g.week);
    if (prev === undefined || k < prev) firstKickoff.set(g.week, k);
  }
  const out: number[] = [];
  for (const [week, kickoff] of firstKickoff) {
    if (kickoff <= nowMs) out.push(week);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The teams playing in one week, sorted.
 *
 * Sorted so the `<option>` order is stable across renders — the games array
 * arrives in whatever order PostgREST returned it, and a select whose options
 * reshuffle under the cursor is the same defect `sortRosterByName` exists to
 * prevent one component over.
 *
 * A bye team is absent, which is what stops the UI offering a choice the RPC
 * answers `no_game_for_team` for.
 */
export function teamsPlayingInWeek(
  games: readonly AdminPickGame[],
  week: number,
): TeamId[] {
  const teams = new Set<TeamId>();
  for (const g of games) {
    if (g.week !== week) continue;
    teams.add(g.home);
    teams.add(g.away);
  }
  return [...teams].sort();
}

/** Fold the loader's payload into the narrow shape the drawer takes. */
export function buildAdminPickData(input: {
  games: readonly AdminPickGame[];
  now: Date;
  currentWeek: number;
  hiddenPickMemberIds: readonly string[];
}): AdminPickData {
  const started = startedWeeks(input.games, input.now);
  const teamsByWeek: Record<number, TeamId[]> = {};
  for (const week of started) {
    teamsByWeek[week] = teamsPlayingInWeek(input.games, week);
  }
  return {
    startedWeeks: started,
    currentWeek: input.currentWeek,
    teamsByWeek,
    hiddenPickMemberIds: [...input.hiddenPickMemberIds],
  };
}

/**
 * What the admin may see about one entry's pick in one week.
 *
 * THREE states, and the third is the whole reason this is a function rather than
 * a ternary at the call site. RLS hands another member's pick back only once its
 * game has kicked off — so in the LIVE week, a member who has picked a 4pm game
 * is indistinguishable from a member who has not picked at all, and both would
 * render "No pick". An admin overwriting a pick they cannot see is not a
 * correction, so `hidden` is drawn with a padlock and its control is disabled.
 */
export type AdminPickView =
  | { kind: "team"; teamId: TeamId; result: "win" | "loss" | "push" | "pending" | null }
  | { kind: "hidden" }
  | { kind: "none" };

export function viewPickForWeek(input: {
  member: Member;
  week: number;
  currentWeek: number;
  hiddenMemberIds: readonly string[];
}): AdminPickView {
  const { member, week, currentWeek, hiddenMemberIds } = input;

  if (week === currentWeek) {
    const pick = member.currentPick;
    // A revealed pick wins over the hidden flag. A membership id can legitimately
    // sit in both sets across a kickoff — `hiddenPickMemberIds` is a snapshot and
    // `currentPick` is the row itself — and the row is the newer fact.
    if (pick && pick.week === week) return { kind: "team", teamId: pick.teamId, result: null };
    if (hiddenMemberIds.includes(member.id)) return { kind: "hidden" };
    return { kind: "none" };
  }

  const past = member.history.find((h) => h.week === week);
  if (past) return { kind: "team", teamId: past.teamId, result: past.result };

  /*
   * A KNOWN, ACCEPTED HOLE. RLS reveals a pick when `kickoff <= now() OR status
   * <> 'scheduled'`, and a POSTPONED game keeps `status = 'scheduled'` while
   * gaining a future kickoff — so a past-week pick on a postponed game stays
   * hidden, and `hiddenPickMemberIds` only ever covers the current week. Such a
   * row reads "No pick" here and an admin could overwrite it unknowingly.
   *
   * Rare, and `pick_overrides` is the mitigation: the change is recorded with
   * the team it replaced, so the question is answerable afterwards. Closing it
   * properly needs a definer READ over other members' hidden picks, which is
   * exactly the privacy path this feature was scoped to avoid.
   */
  return { kind: "none" };
}

/**
 * Teams this entry has already spent, in the weeks the admin can actually SEE.
 *
 * DELIBERATELY INCOMPLETE, and the call site has to say so. `toMember` drops
 * picks for weeks after `currentWeek`, so a team an entry has booked for a
 * FUTURE week is invisible here — while `picks_team_once_per_phase` will still
 * refuse it. So this greys out what is knowable and `admin_set_pick`'s
 * `team_already_used` is the authority for the rest. Offering fewer options than
 * the database would accept is the safe direction; the reverse is not.
 *
 * `exceptWeek` is the week being edited, whose own team must stay selectable —
 * re-picking the same team is a no-op, not a collision.
 */
export function usedTeamsForEntry(member: Member, exceptWeek: number): TeamId[] {
  const used = new Set<TeamId>();
  for (const h of member.history) {
    if (h.week !== exceptWeek) used.add(h.teamId);
  }
  const current = member.currentPick;
  if (current && current.week !== exceptWeek) used.add(current.teamId);
  return [...used];
}

/**
 * Whether the admin may change this row — the UI gate, and it is STRICTER than
 * the RPC's on purpose.
 *
 * `admin_set_pick` gates on the WEEK having started; this also refuses a row
 * whose pick is hidden. The repo's rule is only that the UI must never offer
 * what the database would refuse, so being stricter is always legal — and here
 * it is the difference between a correction and a blind overwrite.
 */
export function canAdminEditPick(
  view: AdminPickView,
  week: number,
  started: readonly number[],
): boolean {
  if (view.kind === "hidden") return false;
  return started.includes(week);
}
