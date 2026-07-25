import { gameWinner, isKickedOff, type Game, type TeamId } from "../nfl/types";
import { TEAMS } from "../nfl/teams";
import { evaluateTeamPick } from "../game/elimination";
import type { GroupRules, Member, PickResult } from "./types";

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
