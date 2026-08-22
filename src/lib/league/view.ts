import { gameWinner, isKickedOff, type Game, type TeamId } from "../nfl/types";
import { TEAMS } from "../nfl/teams";
import { evaluateTeamPick } from "../game/elimination";
import type { SeasonPhase } from "../game/season";
import type { GroupRules, Member, PickResult, TeamRecord } from "./types";

/**
 * Pure view-model helpers shared by the screens. They turn raw members/games
 * into exactly what the UI renders — crucially the per-game pick-privacy reveal,
 * which is derived here (and enforced for real by Postgres RLS server-side).
 */

export type TeamAvailability =
  | { state: "selected" }
  // `result` is optional: a pick still spends its team before its game has
  // produced a result, and My Picks builds this map from a used-team list that
  // carries only the week. `buildTeamStates` still fills it in.
  | { state: "used"; week: number; result?: "win" | "loss" | "push" }
  | { state: "bye" }
  | { state: "available" };

export interface SurvivorCounts {
  alive: number;
  eliminated: number;
  /** Deliberately alive + eliminated, not members.length — see below. */
  total: number;
}

/**
 * The "N out of M still alive" tally, shared by the app header and the standings
 * league summary rather than re-filtered at each call site.
 *
 * `total` counts the two known statuses instead of the array length, so a member
 * row with a status this build doesn't recognise is left out of the denominator
 * rather than silently inflating it.
 */
export function survivorCounts(members: readonly Member[]): SurvivorCounts {
  const alive = members.filter((m) => m.status === "alive").length;
  const eliminated = members.filter((m) => m.status === "eliminated").length;
  return { alive, eliminated, total: alive + eliminated };
}

/**
 * Structurally identical to `RankedMember` in StandingsGrid, declared here
 * rather than imported: this module is pure view-model logic and must not
 * depend on a component (that would be an import cycle waiting to happen).
 */
export interface RankedMemberView {
  member: Member;
  rank: number;
}

/**
 * Standings order: alive before eliminated; among the living, fewer strikes
 * first; among the dead, most-recently eliminated first (they survived longest).
 * Name then id break every tie, so the order is total and stable rather than
 * dependent on the input array.
 *
 * Lives here, not in StandingsClient, because the landing page ranks the same
 * members and importing the client component to reach it would drag
 * AdminSettingsDrawer, LeagueRulesModal and LeagueDetails into a signed-out
 * page's bundle.
 */
export function rankMembers(members: readonly Member[]): RankedMemberView[] {
  const ordered = [...members].sort((a, b) => {
    if (a.status !== b.status) return a.status === "alive" ? -1 : 1;
    if (a.status === "alive") {
      if (a.strikes !== b.strikes) return a.strikes - b.strikes;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    }
    const aw = a.eliminatedWeek ?? 0;
    const bw = b.eliminatedWeek ?? 0;
    if (aw !== bw) return bw - aw;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  return ordered.map((member, i) => ({ member, rank: i + 1 }));
}

/**
 * What the league status bar reads, in one shape for both of its variants.
 *
 * Discriminated on pre-season vs. not, rather than on `SeasonPhase`, because
 * "regular" and "ended" render identically — a week number and a tally — and a
 * three-armed union would invite a third copy of the same strings.
 */
export type StatusLineInput =
  | { kind: "preseason"; joined: number; startsIn: string }
  | { kind: "season"; week: number; alive: number; eliminated: number };

export interface StatusLine {
  /** Top line: the week's name, or "Pre-season". */
  lead: string;
  /**
   * `lead` abbreviated for narrow screens — "W6" for "Week 6". The mobile mockup
   * uses it so the label and the tally fit one line at 393px.
   *
   * Equal to `lead` in the pre-season, which has no shorter form: "Pre-season"
   * is already the short name for a stretch of weeks, not a week number.
   */
  leadShort: string;
  /** The emphasised half of the second line, in near-black. */
  primary: string;
  /** The muted half of the second line. */
  secondary: string;
}

/**
 * `1 survivor` / `2 survivors`, with the count.
 *
 * Exported for the invite card's "27 members", which is the same shape and has
 * the same one failure mode — see `statusLine` below for the bug that made this
 * a helper rather than a ternary at each call site.
 */
export function countNoun(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * The status bar's copy. Extracted from the JSX so the two variants are one
 * function with tests rather than two nearly-identical blocks — which is how
 * `{joined === 1 ? "joined" : "joined"}` survived in the old header: a plural
 * form dutifully applied to a word that has none. "joined" is a past participle
 * here ("29 joined."), not a countable noun, so it never inflects.
 */
export function statusLine(input: StatusLineInput): StatusLine {
  if (input.kind === "preseason") {
    return {
      lead: "Pre-season",
      leadShort: "Pre-season",
      primary: `Starts in ${input.startsIn}.`,
      secondary: `${input.joined} joined.`,
    };
  }
  return {
    lead: `Week ${input.week}`,
    leadShort: `W${input.week}`,
    primary: `${countNoun(input.alive, "survivor")}.`,
    secondary: `${countNoun(input.eliminated, "death")}.`,
  };
}

/**
 * One member's standing in plain language, for the account page's league card.
 *
 * Elimination outranks the calendar: a knocked-out player reads "Eliminated"
 * whatever the season is doing. Only then does the phase matter, and only to
 * distinguish a season that hasn't started from one that has.
 *
 * "Still Standing" rather than "In Season" — it says something about *you*,
 * which is what the surrounding row is for ("Player │ Still Standing │ Buy In").
 */
export function statusLabel(input: { status: Member["status"]; phase: SeasonPhase }): string {
  if (input.status === "eliminated") return "Eliminated";
  if (input.phase === "preseason") return "Pre-season";
  if (input.phase === "ended") return "Season over";
  return "Still Standing";
}

/** Per-team availability for one member's own grid (available / used / bye). */
export function buildTeamStates(
  member: Member,
  week: number,
  byes: TeamId[],
): Map<TeamId, TeamAvailability> {
  const byeSet = new Set(byes);
  const usedByTeam = new Map(member.history.map((h) => [h.teamId, h]));
  const out = new Map<TeamId, TeamAvailability>();
  for (const team of TEAMS) {
    const id = team.id;
    if (member.currentPick && member.currentPick.week === week && member.currentPick.teamId === id) {
      out.set(id, { state: "selected" });
      continue;
    }
    const used = usedByTeam.get(id);
    if (used) {
      out.set(id, { state: "used", week: used.week, result: used.result });
      continue;
    }
    out.set(id, byeSet.has(id) ? { state: "bye" } : { state: "available" });
  }
  return out;
}

export interface AvailabilityCounts {
  available: number;
  used: number;
  bye: number;
}

export function countStates(states: Map<TeamId, TeamAvailability>): AvailabilityCounts {
  let available = 0;
  let used = 0;
  let bye = 0;
  for (const v of states.values()) {
    if (v.state === "available") available += 1;
    else if (v.state === "used") used += 1;
    else if (v.state === "bye") bye += 1;
  }
  return { available, used, bye };
}

/** How the team picker orders its list. */
export type TeamSort = "record" | "kickoff" | "default";

/** Win percentage with a half-credit tie, guarding an empty (0-game) record. */
function winPct(r: TeamRecord): number {
  const games = r.w + r.l + r.t;
  return games === 0 ? 0 : (r.w + 0.5 * r.t) / games;
}

/** A team you can still act on this week (pickable, or your current pick). */
function isActionable(state: TeamAvailability): boolean {
  return state.state === "available" || state.state === "selected";
}

/**
 * Order (and optionally filter) the picker's teams. Pure and mock-free — the
 * record/schedule lookups are injected the same way `viewCurrentPick` takes
 * `gameForTeam`, so this stays unit-testable and reusable across layouts.
 *
 * `teamIds` is expected to arrive in a stable base order (the alphabetical
 * `TEAMS` order); ties fall back to that order via a stable sort.
 */
export function orderPickerTeams(
  teamIds: TeamId[],
  states: Map<TeamId, TeamAvailability>,
  opts: { sort: TeamSort; availableOnly: boolean; groupUnavailable?: boolean },
  accessors: {
    recordFor: (id: TeamId) => TeamRecord;
    gameFor: (id: TeamId) => Game | undefined;
  },
): TeamId[] {
  const stateFor = (id: TeamId): TeamAvailability => states.get(id) ?? { state: "available" };

  const ids = opts.availableOnly
    ? teamIds.filter((id) => isActionable(stateFor(id)))
    : [...teamIds];

  if (opts.sort === "default") return ids;

  return ids.sort((a, b) => {
    // Actionable teams lead; used/bye sink to the bottom (still shown, disabled).
    // Opt out with `groupUnavailable: false` and the sort is a pure ranking of
    // all 32 — which is what the grid layout wants, where a bye team with a good
    // record is still worth seeing in its rightful place.
    if (opts.groupUnavailable !== false) {
      const aAct = isActionable(stateFor(a));
      const bAct = isActionable(stateFor(b));
      if (aAct !== bAct) return aAct ? -1 : 1;
    }

    if (opts.sort === "record") {
      const diff = winPct(accessors.recordFor(b)) - winPct(accessors.recordFor(a));
      if (diff !== 0) return diff;
      return accessors.recordFor(b).w - accessors.recordFor(a).w;
    }

    // kickoff — soonest first; teams with no game (bye) sort to the end.
    const ka = accessors.gameFor(a)?.kickoff;
    const kb = accessors.gameFor(b)?.kickoff;
    if (ka === kb) return 0;
    if (ka === undefined) return 1;
    if (kb === undefined) return -1;
    return ka < kb ? -1 : 1;
  });
}

export type PickDisplayStatus = "hidden" | "scheduled" | "live" | "final" | "none";

export interface PickView {
  hasPick: boolean;
  teamId?: TeamId;
  game?: Game;
  /** Whether this viewer may see the team (own pick, or the game kicked off). */
  revealed: boolean;
  status: PickDisplayStatus;
  /** Resolved only when revealed and the game is final; "pending" while live. */
  result?: PickResult;
}

/**
 * How `member`'s current-week pick should appear to `viewerId`. Encodes the
 * privacy rule: another player's pick stays hidden until that specific team's
 * game has kicked off.
 */
export function viewCurrentPick(
  member: Member,
  viewerId: string,
  week: number,
  gameForTeam: (week: number, teamId: TeamId) => Game | undefined,
  rules: GroupRules,
  now: Date,
): PickView {
  const pick = member.currentPick && member.currentPick.week === week ? member.currentPick : null;
  if (!pick) return { hasPick: false, revealed: true, status: "none" };

  const game = gameForTeam(week, pick.teamId);
  const isOwn = member.id === viewerId;
  const kicked = game ? isKickedOff(game, now) : false;
  const revealed = isOwn || kicked;

  let status: PickDisplayStatus = "scheduled";
  if (!revealed) status = "hidden";
  else if (game?.status === "final") status = "final";
  else if (game?.status === "in_progress" || game?.status === "delayed") status = "live";

  let result: PickResult | undefined;
  if (revealed && game) {
    result = gameWinner(game) === null ? "pending" : evaluateTeamPick(game, pick.teamId, rules);
  }

  return {
    hasPick: true,
    teamId: pick.teamId,
    game,
    revealed,
    status,
    result,
  };
}

/** The scoreline from the picked team's perspective. */
export function teamScoreline(
  game: Game,
  teamId: TeamId,
): { for: number; against: number; opponent: TeamId } | null {
  if (game.homeScore === null || game.awayScore === null) return null;
  if (game.home === teamId) return { for: game.homeScore, against: game.awayScore, opponent: game.away };
  if (game.away === teamId) return { for: game.awayScore, against: game.homeScore, opponent: game.home };
  return null;
}

export function opponentOf(game: Game, teamId: TeamId): TeamId {
  return game.home === teamId ? game.away : game.home;
}

export function isHome(game: Game, teamId: TeamId): boolean {
  return game.home === teamId;
}
