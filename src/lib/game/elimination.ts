import { gameWinner, isKickedOff, type Game, type TeamId } from "../nfl/types";
import {
  strikeAllowance,
  type GroupRules,
  type Member,
  type PickResult,
} from "../league/types";

/**
 * The pure game engine. No I/O, no dates-from-now magic: every function that
 * cares about "now" takes it as an argument so it is fully testable and the
 * scheduled job, the server, and the tests all share one implementation.
 */

/** Evaluate a single team pick against the game that team played. */
export function evaluateTeamPick(
  game: Game | null,
  teamId: TeamId,
  rules: GroupRules,
): PickResult {
  if (!game) return "pending"; // no game found (e.g. bye) — nothing to resolve
  const winner = gameWinner(game);
  if (winner === null) return "pending"; // not final yet
  if (winner === teamId) return "win";
  if (winner === "tie") return rules.tieRule === "push" ? "push" : "loss";
  return "loss";
}

export interface WeekEvaluationInput {
  /** The team the player picked this week, or null if they haven't picked. */
  teamId: TeamId | null;
  /** The game the picked team plays in (null when no pick / bye). */
  game: Game | null;
  /** Kickoff of the last game of the week — the true final pick deadline. */
  weekFinalKickoff: Date;
  rules: GroupRules;
  now: Date;
}

/**
 * Evaluate one week for one player, including the missed-pick rule: not picking
 * any team by the last kickoff of the week counts as a loss, identical to a
 * losing pick.
 */
export function evaluateWeek(input: WeekEvaluationInput): PickResult {
  const { teamId, game, weekFinalKickoff, rules, now } = input;
  if (teamId === null) {
    // Missed pick becomes a loss only once the week's final kickoff has passed.
    return now.getTime() >= weekFinalKickoff.getTime() ? "loss" : "no_pick";
  }
  return evaluateTeamPick(game, teamId, rules);
}

/** A week result that actually damages a player's standing. */
export function isDamaging(result: PickResult): boolean {
  return result === "loss";
}

export interface StatusResult {
  status: "alive" | "eliminated";
  strikes: number;
  eliminatedWeek: number | null;
}

/**
 * Fold an ordered list of week results into a player's status. Results must be
 * ordered by week ascending; `weeks[i]` corresponds to `weekNumbers[i]`.
 */
export function computeStatus(
  rules: GroupRules,
  results: PickResult[],
  weekNumbers: number[],
): StatusResult {
  const allowance = strikeAllowance(rules.eliminationType);
  let strikes = 0;
  let eliminatedWeek: number | null = null;

  for (let i = 0; i < results.length; i++) {
    if (eliminatedWeek !== null) break;
    if (isDamaging(results[i]!)) {
      strikes += 1;
      if (strikes >= allowance) {
        eliminatedWeek = weekNumbers[i] ?? null;
      }
    }
  }

  return {
    status: eliminatedWeek === null ? "alive" : "eliminated",
    strikes,
    eliminatedWeek,
  };
}

/**
 * Can a team be picked right now? This is the hard survival rule, enforced
 * server-side (never trusted to the greyed-out UI).
 */
export interface PickGuardInput {
  /** Only the fields the guard actually needs — status and used-team history. */
  member: { status: Member["status"]; history: { teamId: TeamId }[] };
  teamId: TeamId;
  /** The game the team plays in the target week. */
  game: Pick<Game, "status" | "kickoff"> | null;
  /** Whether entry for the group is still open (before Week 1 first kickoff). */
  entryOpen: boolean;
  now: Date;
}

export type PickRejection =
  | "eliminated"
  | "team_already_used"
  | "game_kicked_off"
  | "no_game_for_team" // bye week — team isn't playing
  | "entry_closed";

export function canPick(input: PickGuardInput): { ok: true } | { ok: false; reason: PickRejection } {
  const { member, teamId, game, entryOpen, now } = input;
  if (member.status === "eliminated") return { ok: false, reason: "eliminated" };
  if (!entryOpen) return { ok: false, reason: "entry_closed" };
  if (!game) return { ok: false, reason: "no_game_for_team" };
  if (isTeamUsed(member.history, teamId)) return { ok: false, reason: "team_already_used" };
  if (isKickedOff(game, now)) return { ok: false, reason: "game_kicked_off" };
  return { ok: true };
}

export function isTeamUsed(history: { teamId: TeamId }[], teamId: TeamId): boolean {
  return history.some((h) => h.teamId === teamId);
}

export type SeasonState =
  | { kind: "in_progress" }
  | { kind: "winner"; memberId: string }
  | { kind: "multi_survivor"; memberIds: string[] } // Week 18 ended, >1 alive
  | { kind: "wipeout"; week: number }; // everyone left lost the same week

/**
 * Season end condition (fixed rule, not configurable): the season ends when
 * either only one player remains, or Week 18 concludes — whichever first.
 * Wipeout (0 survivors) and multi-survivor at Week 18 are flagged for admin
 * resolution rather than silently resolved.
 */
export function seasonState(
  members: Pick<Member, "id" | "status">[],
  opts: { currentWeek: number; finalWeek?: number; wipeoutWeek?: number | null },
): SeasonState {
  const finalWeek = opts.finalWeek ?? 18;
  const alive = members.filter((m) => m.status === "alive");

  if (alive.length === 0) {
    return { kind: "wipeout", week: opts.wipeoutWeek ?? opts.currentWeek };
  }
  if (alive.length === 1) {
    return { kind: "winner", memberId: alive[0]!.id };
  }
  if (opts.currentWeek >= finalWeek) {
    return { kind: "multi_survivor", memberIds: alive.map((m) => m.id) };
  }
  return { kind: "in_progress" };
}
