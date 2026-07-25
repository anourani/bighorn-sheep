import type { TeamId } from "../nfl/types";

/** One loss = out, or two losses = out. */
export type EliminationType = "single" | "two_time";

/**
 * How a tie is treated (a tie means the picked team did not win):
 *  - "push": the player survives, tie is neither win nor loss.
 *  - "loss": the tie is treated identically to a losing pick.
 * (In a two-time league a "loss" is simply one strike — see PRD note.)
 */
export type TieRule = "push" | "loss";

export type MemberStatus = "alive" | "eliminated";
export type Role = "admin" | "player";

/** Outcome of a single week's pick for a player. */
export type PickResult =
  | "win"
  | "loss"
  | "push"
  | "pending" // picked, game not final yet
  | "no_pick"; // hasn't picked and the week's final kickoff hasn't passed yet

export interface GroupRules {
  eliminationType: EliminationType;
  tieRule: TieRule;
}

export interface Group {
  id: string;
  name: string;
  season: number;
  rules: GroupRules;
  inviteCode: string;
  /** First kickoff of Week 1 — entry closes here (survival convention). */
  entryClosesAt: string;
  /** Set once Week 1 picks begin; rules are frozen after this. */
  settingsLockedAt?: string | null;
}

export interface HistoryPick {
  week: number;
  teamId: TeamId;
  result: "win" | "loss" | "push";
}

export interface CurrentPick {
  week: number;
  teamId: TeamId;
  /** The game this team plays in this week — drives the per-game lock/reveal. */
  gameId: string;
}

export interface Member {
  id: string;
  name: string;
  role: Role;
  status: MemberStatus;
  /** Losses accrued (0..allowance). */
  strikes: number;
  eliminatedWeek?: number | null;
  history: HistoryPick[];
  currentPick?: CurrentPick | null;
}

/** Losses tolerated before elimination. */
export function strikeAllowance(type: EliminationType): number {
  return type === "single" ? 1 : 2;
}

/**
 * A team's season win-loss record. Standings data (time-varying, fed from the
 * provider/Postgres in production) — kept out of the static `Team` domain type.
 */
export interface TeamRecord {
  w: number;
  l: number;
  t: number;
}
