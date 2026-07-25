import { gameWinner, isKickedOff, type Game, type TeamId } from "../nfl/types";
import { TEAMS } from "../nfl/teams";
import { evaluateTeamPick } from "../game/elimination";
import type { GroupRules, Member, PickResult, TeamRecord } from "./types";

/**
 * Pure view-model helpers shared by the screens. They turn raw members/games
 * into exactly what the UI renders — crucially the per-game pick-privacy reveal,
 * which is derived here (and enforced for real by Postgres RLS server-side).
 */

export type TeamAvailability =
  | { state: "selected" }
  | { state: "used"; week: number; result: "win" | "loss" | "push" }
  | { state: "bye" }
  | { state: "available" };

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
  opts: { sort: TeamSort; availableOnly: boolean },
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
    const aAct = isActionable(stateFor(a));
    const bAct = isActionable(stateFor(b));
    if (aAct !== bAct) return aAct ? -1 : 1;

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
